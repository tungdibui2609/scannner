import { NextResponse } from "next/server";
import { google } from "googleapis";
import { ensureGoogleKeyFromB64, getGoogleCredentials } from "@/lib/env";
import { LOT_POSITIONS_SHEET_RANGE, LOTS_SHEET_RANGE, USER_SHEET_ID } from "@/config/sheets";
import { appendAuditLog } from "@/lib/auditLog";
import { getVNTimestamp } from "@/lib/vnDateTime";
import { cookies } from "next/headers";

ensureGoogleKeyFromB64();

async function getSheets(scopes: string[]) {
    const { email, key } = getGoogleCredentials();
    const jwt = new google.auth.JWT({ email, key, scopes });
    return google.sheets({ version: "v4", auth: jwt });
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { items } = body;

        if (!items || !Array.isArray(items)) {
            return NextResponse.json({ error: "Invalid data format" }, { status: 400 });
        }

        if (items.length === 0) {
            return NextResponse.json({ error: "No items to sync" }, { status: 400 });
        }

        console.log("Received sync data:", items);

        const sheets = await getSheets(["https://www.googleapis.com/auth/spreadsheets"]);
        const results = [];
        let successCount = 0;
        let failCount = 0;

        // Ensure lot_pos tab exists
        const tab = LOT_POSITIONS_SHEET_RANGE.split("!")[0] || "lot_pos";
        const meta = await sheets.spreadsheets.get({ spreadsheetId: USER_SHEET_ID });
        const found = meta.data.sheets?.find((s: any) => s.properties?.title === tab);

        if (!found) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: USER_SHEET_ID,
                requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] },
            });
            await sheets.spreadsheets.values.update({
                spreadsheetId: USER_SHEET_ID,
                range: `${tab}!A1:B1`,
                valueInputOption: "RAW",
                requestBody: { values: [["LotCode", "PositionCode"]] },
            });
        }

        // Get user info from cookies
        let username = "";
        let nameFromCookie = "";
        try {
            const store = await cookies();
            const c = store.get("wms_user")?.value;
            if (c) {
                const v = JSON.parse(decodeURIComponent(c));
                username = (v?.username || "").toString();
                nameFromCookie = (v?.name || "").toString();
            }
        } catch { }

        // Read lot_pos sheet ONCE for conflict checking and UPSERT logic
        const cur = await sheets.spreadsheets.values.get({ spreadsheetId: USER_SHEET_ID, range: LOT_POSITIONS_SHEET_RANGE });
        const rows = cur.data.values || [];
        const data = rows.slice(1); // Skip header

        // Create a map of Position -> LotCode for conflict lookup
        const positionMap = new Map<string, string>();
        // Create a map of LotCode -> Row number (1-based) for UPSERT logic
        const lotPositionRows = new Map<string, number>();

        data.forEach((r: any[], index: number) => {
            const lCode = (r[0] || "").toString().trim();
            const pCode = (r[1] || "").toString().trim();
            if (pCode) positionMap.set(pCode.toUpperCase(), lCode);
            // Store the first row for each LOT (for UPSERT - update existing row)
            if (lCode && !lotPositionRows.has(lCode)) {
                lotPositionRows.set(lCode, index + 2); // +2: skip header (1) and convert to 1-based index
            }
        });

        for (const item of items) {
            const { id: lotCode, position: posCode } = item;

            if (!posCode || !posCode.trim()) {
                failCount++;
                results.push({ lotCode, success: false, error: "No position provided" });
                continue;
            }

            const targetPos = posCode.trim().toUpperCase();
            const currentOccupant = positionMap.get(targetPos);

            // Conflict Check: If position is occupied by a DIFFERENT Lot
            if (currentOccupant && currentOccupant !== lotCode.trim()) {
                failCount++;
                results.push({
                    lotCode,
                    success: false,
                    error: `Conflict: Position ${posCode} is already occupied by ${currentOccupant}`,
                    conflict: true,
                    currentOccupant
                });
                console.warn(`✗ Conflict ${lotCode} -> ${posCode} (Occupied by ${currentOccupant})`);
                continue;
            }

            // Check if this LOT already has a position assignment (same position = skip)
            const existingRow = lotPositionRows.get(lotCode.trim());
            const existingPos = existingRow ? positionMap.get(targetPos) : null;

            // If same LOT already assigned to same position, skip
            if (existingRow && currentOccupant === lotCode.trim()) {
                successCount++;
                results.push({ lotCode, success: true, message: "Already assigned" });
                console.log(`✓ Skipped (Same assignment) ${lotCode} -> ${posCode}`);
                continue;
            }

            try {
                // UPSERT Logic: UPDATE if LOT exists, APPEND if new
                if (existingRow) {
                    // UPDATE existing row (like QLK dashboard)
                    await sheets.spreadsheets.values.update({
                        spreadsheetId: USER_SHEET_ID,
                        range: `${tab}!A${existingRow}:B${existingRow}`,
                        valueInputOption: "RAW",
                        requestBody: { values: [[lotCode.trim(), posCode.trim()]] },
                    });
                    console.log(`✓ Updated ${lotCode} -> ${posCode} (Row ${existingRow})`);
                } else {
                    // APPEND new row
                    await sheets.spreadsheets.values.append({
                        spreadsheetId: USER_SHEET_ID,
                        range: `${tab}!A:B`,
                        valueInputOption: "RAW",
                        insertDataOption: "INSERT_ROWS",
                        requestBody: { values: [[lotCode.trim(), posCode.trim()]] },
                    });
                    console.log(`✓ Appended ${lotCode} -> ${posCode}`);
                }

                // Update LOTS sheet column O (Position) - Update to LATEST scanned position
                const resLots = await sheets.spreadsheets.values.get({ spreadsheetId: USER_SHEET_ID, range: LOTS_SHEET_RANGE });
                const rowsLots = resLots.data.values || [];
                const toUpdateRows: number[] = [];
                for (let i = 1; i < rowsLots.length; i++) {
                    const r = rowsLots[i] || [];
                    if (((r[0] || '').toString().trim() === lotCode.trim())) {
                        toUpdateRows.push(i + 1);
                    }
                }
                if (toUpdateRows.length) {
                    const tabLots = LOTS_SHEET_RANGE.split('!')[0] || 'lot';
                    const dataReq = toUpdateRows.map((row) => ({ range: `${tabLots}!O${row}:O${row}`, values: [[posCode.trim()]] }));
                    await sheets.spreadsheets.values.batchUpdate({
                        spreadsheetId: USER_SHEET_ID,
                        requestBody: { valueInputOption: 'RAW', data: dataReq }
                    });
                }

                // Audit log
                appendAuditLog({
                    ts: getVNTimestamp(),
                    username: username || "unknown",
                    name: nameFromCookie || undefined,
                    method: "PUT",
                    path: "/api/locations/positions",
                    details: {
                        lotCode: lotCode.trim(),
                        posCode: posCode.trim(),
                        action: existingRow ? "Cập nhật vị trí (từ QR)" : "Gán vị trí (từ QR)"
                    }
                });

                successCount++;
                results.push({ lotCode, success: true });

                // Update local maps for subsequent items in the same batch
                positionMap.set(targetPos, lotCode.trim());
                if (!existingRow) {
                    // Approximate: We don't know exact row, but it won't be used in same batch anyway
                    lotPositionRows.set(lotCode.trim(), rows.length + 1);
                }

            } catch (err: any) {
                failCount++;
                results.push({ lotCode, success: false, error: err.message });
                console.error(`✗ Error ${lotCode}:`, err.message);
            }
        }

        return NextResponse.json({
            success: true,
            total: items.length,
            successCount,
            failCount,
            results,
        });
    } catch (error: any) {
        console.error("Sync error:", error);
        return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
    }
}
