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

        // Read lot_pos sheet ONCE for conflict checking
        const cur = await sheets.spreadsheets.values.get({ spreadsheetId: USER_SHEET_ID, range: LOT_POSITIONS_SHEET_RANGE });
        const rows = cur.data.values || [];
        const data = rows.slice(1); // Skip header

        // Create a map of Position -> LotCode for fast lookup
        const positionMap = new Map<string, string>();
        // Create a map of LotCode -> RowIndex for updates
        const lotRowMap = new Map<string, number>();

        data.forEach((r: any[], idx: number) => {
            const lCode = (r[0] || "").toString().trim();
            const pCode = (r[1] || "").toString().trim();
            if (pCode) positionMap.set(pCode.toUpperCase(), lCode);
            if (lCode) lotRowMap.set(lCode, idx + 2); // 2 = 1 (header) + 1 (0-based)
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

            try {
                // Update lot_pos sheet
                const absoluteRow = lotRowMap.get(lotCode.trim());

                if (absoluteRow) {
                    await sheets.spreadsheets.values.update({
                        spreadsheetId: USER_SHEET_ID,
                        range: `${tab}!A${absoluteRow}:B${absoluteRow}`,
                        valueInputOption: "RAW",
                        requestBody: { values: [[lotCode.trim(), posCode.trim()]] },
                    });
                } else {
                    await sheets.spreadsheets.values.append({
                        spreadsheetId: USER_SHEET_ID,
                        range: `${tab}!A:B`,
                        valueInputOption: "RAW",
                        insertDataOption: "INSERT_ROWS",
                        requestBody: { values: [[lotCode.trim(), posCode.trim()]] },
                    });
                }

                // Update LOTS sheet column O (Position)
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
                        action: "Gán vị trí (từ QR)"
                    }
                });

                successCount++;
                results.push({ lotCode, success: true });
                console.log(`✓ Updated ${lotCode} -> ${posCode}`);

                // Update local map for subsequent items in the same batch
                positionMap.set(targetPos, lotCode.trim());

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
