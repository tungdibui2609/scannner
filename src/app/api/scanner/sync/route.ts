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

/**
 * Sync position assignments from scanner app.
 * 
 * Strategy: Read -> Modify in memory -> Write back
 * Same approach as updating LOTS sheet column O (which works correctly!)
 * 
 * For lot_pos:
 * - Read all rows
 * - Modify: if LOT exists, update its position; if new, add to array
 * - Write entire data back using values.update (NOT deleteDimension)
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { items } = body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return NextResponse.json({ error: "No items to sync" }, { status: 400 });
        }

        console.log("=== SCANNER SYNC (READ-MODIFY-WRITE) START ===");
        console.log("Items:", items.length);

        const sheets = await getSheets(["https://www.googleapis.com/auth/spreadsheets"]);
        const tab = LOT_POSITIONS_SHEET_RANGE.split("!")[0] || "lot_pos";

        // Ensure lot_pos tab exists
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

        // Get user info
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

        const results: any[] = [];
        let successCount = 0;
        let failCount = 0;

        for (const item of items) {
            const lotCode = (item.id || "").toString().trim();
            const posCode = (item.position || "").toString().trim();

            console.log(`\n--- Processing: ${lotCode} -> ${posCode} ---`);

            if (!lotCode || !posCode) {
                failCount++;
                results.push({ lotCode, success: false, error: "Missing data" });
                continue;
            }

            try {
                // Step 1: Read ALL lot_pos data
                const res = await sheets.spreadsheets.values.get({
                    spreadsheetId: USER_SHEET_ID,
                    range: LOT_POSITIONS_SHEET_RANGE
                });
                const allRows = res.data.values || [];

                // Ensure header exists
                if (allRows.length === 0) {
                    allRows.push(["LotCode", "PositionCode"]);
                }

                console.log(`Read ${allRows.length} rows (including header)`);

                // Step 2: Build data array and check for conflicts
                // data = all rows except header
                const header = allRows[0];
                const data: [string, string][] = [];

                let existingRowIndex = -1; // index in data array (not allRows)
                let oldPosCode = "";
                let conflictLot = "";
                const targetPosUpper = posCode.toUpperCase();

                for (let i = 1; i < allRows.length; i++) {
                    const row = allRows[i] || [];
                    const rowLot = (row[0] || "").toString().trim();
                    const rowPos = (row[1] || "").toString().trim();

                    // Check if this is the LOT we're updating
                    if (rowLot === lotCode) {
                        existingRowIndex = data.length; // will be the index after push
                        oldPosCode = rowPos;
                    }

                    // Check for conflict
                    if (rowPos.toUpperCase() === targetPosUpper && rowLot !== lotCode) {
                        conflictLot = rowLot;
                    }

                    data.push([rowLot, rowPos]);
                }

                // Conflict check
                if (conflictLot) {
                    failCount++;
                    results.push({
                        lotCode,
                        success: false,
                        error: `Vị trí ${posCode} đã có ${conflictLot}`,
                        conflict: true,
                        currentOccupant: conflictLot
                    });
                    console.log(`CONFLICT: ${posCode} -> ${conflictLot}`);
                    continue;
                }

                // Check if same assignment already
                if (existingRowIndex >= 0 && oldPosCode.toUpperCase() === targetPosUpper) {
                    successCount++;
                    results.push({ lotCode, success: true, message: "Already assigned" });
                    console.log("SKIP: Same assignment");
                    continue;
                }

                // Step 3: Modify data in memory
                if (existingRowIndex >= 0) {
                    // UPDATE existing entry
                    data[existingRowIndex] = [lotCode, posCode];
                    console.log(`MODIFIED data[${existingRowIndex}]: ${lotCode} -> ${posCode} (was ${oldPosCode})`);
                } else {
                    // ADD new entry
                    data.push([lotCode, posCode]);
                    console.log(`ADDED to data: ${lotCode} -> ${posCode}`);
                }

                // Step 4: Write back ENTIRE sheet using values.update
                // This is the SAME method used for LOTS sheet column O (which works!)
                const newAllRows = [header, ...data];
                const writeRange = `${tab}!A1:B${newAllRows.length}`;

                console.log(`WRITING ${newAllRows.length} rows to ${writeRange}`);

                await sheets.spreadsheets.values.update({
                    spreadsheetId: USER_SHEET_ID,
                    range: writeRange,
                    valueInputOption: "RAW",
                    requestBody: { values: newAllRows },
                });

                console.log(`SUCCESS: Written to sheet`);

                // Step 5: Update LOTS sheet column O (same as before - this works)
                try {
                    const tabLots = LOTS_SHEET_RANGE.split('!')[0] || 'lot';
                    const lotsRes = await sheets.spreadsheets.values.get({
                        spreadsheetId: USER_SHEET_ID,
                        range: LOTS_SHEET_RANGE
                    });
                    const lotsRows = lotsRes.data.values || [];
                    const updateData: { range: string; values: any[][] }[] = [];

                    for (let i = 1; i < lotsRows.length; i++) {
                        const row = lotsRows[i] || [];
                        if ((row[0] || "").toString().trim() === lotCode) {
                            updateData.push({
                                range: `${tabLots}!O${i + 1}`,
                                values: [[posCode]]
                            });
                        }
                    }

                    if (updateData.length > 0) {
                        await sheets.spreadsheets.values.batchUpdate({
                            spreadsheetId: USER_SHEET_ID,
                            requestBody: { valueInputOption: 'RAW', data: updateData }
                        });
                    }
                } catch (e) {
                    console.error("Error updating LOTS:", e);
                }

                // Step 6: Audit log
                appendAuditLog({
                    ts: getVNTimestamp(),
                    username: username || "scanner",
                    name: nameFromCookie || undefined,
                    method: "PUT",
                    path: "/api/locations/positions",
                    details: {
                        lotCode,
                        posCode,
                        oldPosCode: oldPosCode || undefined,
                        action: oldPosCode ? "Cập nhật vị trí (QR)" : "Gán vị trí mới (QR)"
                    }
                });

                successCount++;
                results.push({ lotCode, success: true });

            } catch (err: any) {
                failCount++;
                results.push({ lotCode, success: false, error: err.message });
                console.error(`ERROR ${lotCode}:`, err.message);
            }
        }

        console.log(`\n=== SYNC DONE: ${successCount} OK, ${failCount} FAIL ===\n`);

        return NextResponse.json({
            success: true,
            total: items.length,
            successCount,
            failCount,
            results,
        });
    } catch (error: any) {
        console.error("Sync error:", error);
        return NextResponse.json({ error: error.message || "Server error" }, { status: 500 });
    }
}
