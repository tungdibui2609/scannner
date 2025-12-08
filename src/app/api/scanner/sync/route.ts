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
 * Strategy: DELETE + APPEND (instead of UPDATE)
 * - If LOT already exists in lot_pos -> DELETE old row first, then APPEND new
 * - If LOT is new -> just APPEND
 * 
 * This avoids all issues with UPDATE row index calculation.
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { items } = body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return NextResponse.json({ error: "No items to sync" }, { status: 400 });
        }

        console.log("=== SCANNER SYNC (DELETE+APPEND) START ===");
        console.log("Items to sync:", items.length);

        const sheets = await getSheets(["https://www.googleapis.com/auth/spreadsheets"]);
        const tab = LOT_POSITIONS_SHEET_RANGE.split("!")[0] || "lot_pos";

        // Get sheet ID for delete operations
        const meta = await sheets.spreadsheets.get({ spreadsheetId: USER_SHEET_ID });
        let sheetId: number | null = null;
        const foundSheet = meta.data.sheets?.find((s: any) => s.properties?.title === tab);

        if (!foundSheet) {
            // Create sheet if doesn't exist
            const addRes = await sheets.spreadsheets.batchUpdate({
                spreadsheetId: USER_SHEET_ID,
                requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] },
            });
            sheetId = addRes.data.replies?.[0]?.addSheet?.properties?.sheetId ?? null;
            await sheets.spreadsheets.values.update({
                spreadsheetId: USER_SHEET_ID,
                range: `${tab}!A1:B1`,
                valueInputOption: "RAW",
                requestBody: { values: [["LotCode", "PositionCode"]] },
            });
        } else {
            sheetId = foundSheet.properties?.sheetId ?? null;
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
                // Step 1: Read current data
                const res = await sheets.spreadsheets.values.get({
                    spreadsheetId: USER_SHEET_ID,
                    range: LOT_POSITIONS_SHEET_RANGE
                });
                const allRows = res.data.values || [];

                // Step 2: Check for conflict (position occupied by different LOT)
                const targetPosUpper = posCode.toUpperCase();
                let conflictLot = "";
                for (let i = 1; i < allRows.length; i++) {
                    const row = allRows[i] || [];
                    const rowLot = (row[0] || "").toString().trim();
                    const rowPos = (row[1] || "").toString().trim().toUpperCase();
                    if (rowPos === targetPosUpper && rowLot !== lotCode) {
                        conflictLot = rowLot;
                        break;
                    }
                }

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

                // Step 3: Find old row(s) for this LOT and check if same
                const rowsToDelete: number[] = []; // 0-based indices
                let oldPosCode = "";
                for (let i = 1; i < allRows.length; i++) {
                    const row = allRows[i] || [];
                    const rowLot = (row[0] || "").toString().trim();
                    if (rowLot === lotCode) {
                        rowsToDelete.push(i); // 0-based index in allRows
                        if (!oldPosCode) {
                            oldPosCode = (row[1] || "").toString().trim();
                        }
                    }
                }

                // Skip if same assignment already exists
                if (rowsToDelete.length === 1 && oldPosCode.toUpperCase() === targetPosUpper) {
                    successCount++;
                    results.push({ lotCode, success: true, message: "Already assigned" });
                    console.log("SKIP: Same assignment");
                    continue;
                }

                // Step 4: DELETE old row(s) if exists (using batchUpdate deleteRows)
                if (rowsToDelete.length > 0 && sheetId !== null) {
                    // Delete from bottom to top to preserve indices
                    rowsToDelete.sort((a, b) => b - a);

                    const deleteRequests = rowsToDelete.map(rowIndex => ({
                        deleteDimension: {
                            range: {
                                sheetId: sheetId,
                                dimension: "ROWS",
                                startIndex: rowIndex,  // 0-based
                                endIndex: rowIndex + 1
                            }
                        }
                    }));

                    await sheets.spreadsheets.batchUpdate({
                        spreadsheetId: USER_SHEET_ID,
                        requestBody: { requests: deleteRequests }
                    });
                    console.log(`DELETED ${rowsToDelete.length} old row(s) for ${lotCode}`);
                }

                // Step 5: APPEND new row
                await sheets.spreadsheets.values.append({
                    spreadsheetId: USER_SHEET_ID,
                    range: `${tab}!A:B`,
                    valueInputOption: "RAW",
                    insertDataOption: "INSERT_ROWS",
                    requestBody: { values: [[lotCode, posCode]] },
                });
                console.log(`APPENDED: ${lotCode} -> ${posCode}`);

                // Step 6: Update LOTS sheet column O
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

                // Step 7: Audit log
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
                console.log(`SUCCESS: ${lotCode} -> ${posCode}`);

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
