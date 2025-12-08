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
 * This is a COMPLETE REWRITE to match QLK dashboard behavior exactly.
 * 
 * For each item:
 * 1. Find the LOT in lot_pos sheet
 * 2. If LOT exists -> UPDATE that specific row
 * 3. If LOT doesn't exist -> APPEND new row
 * 4. Also update LOTS sheet column O (Position)
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { items } = body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return NextResponse.json({ error: "No items to sync" }, { status: 400 });
        }

        console.log("=== SCANNER SYNC START ===");
        console.log("Received items:", JSON.stringify(items, null, 2));

        const sheets = await getSheets(["https://www.googleapis.com/auth/spreadsheets"]);
        const tab = LOT_POSITIONS_SHEET_RANGE.split("!")[0] || "lot_pos";

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

        // Ensure lot_pos tab exists with header
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

        const results: any[] = [];
        let successCount = 0;
        let failCount = 0;

        // Process each item one by one
        for (const item of items) {
            const lotCode = (item.id || "").toString().trim();
            const posCode = (item.position || "").toString().trim();

            console.log(`\n--- Processing: ${lotCode} -> ${posCode} ---`);

            if (!lotCode || !posCode) {
                failCount++;
                results.push({ lotCode, success: false, error: "Missing lotCode or posCode" });
                console.log("SKIP: Missing data");
                continue;
            }

            try {
                // Step 1: Read FRESH data from lot_pos sheet
                const res = await sheets.spreadsheets.values.get({
                    spreadsheetId: USER_SHEET_ID,
                    range: LOT_POSITIONS_SHEET_RANGE
                });
                const allRows = res.data.values || [];
                console.log(`Read ${allRows.length} rows from lot_pos`);

                // Step 2: Find the row index for this LOT (skip header at index 0)
                let foundRowIndex = -1; // 0-based index in allRows
                let oldPosCode = "";

                for (let i = 1; i < allRows.length; i++) {
                    const row = allRows[i] || [];
                    const rowLotCode = (row[0] || "").toString().trim();
                    if (rowLotCode === lotCode) {
                        foundRowIndex = i;
                        oldPosCode = (row[1] || "").toString().trim();
                        console.log(`Found LOT at allRows[${i}] = Sheet row ${i + 1}, oldPos = ${oldPosCode}`);
                        break;
                    }
                }

                // Step 3: Check for conflict - position is occupied by DIFFERENT lot
                const targetPosUpper = posCode.toUpperCase();
                let conflictLot = "";
                for (let i = 1; i < allRows.length; i++) {
                    const row = allRows[i] || [];
                    const rowLotCode = (row[0] || "").toString().trim();
                    const rowPosCode = (row[1] || "").toString().trim().toUpperCase();
                    if (rowPosCode === targetPosUpper && rowLotCode !== lotCode) {
                        conflictLot = rowLotCode;
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
                    console.log(`CONFLICT: ${posCode} occupied by ${conflictLot}`);
                    continue;
                }

                // Step 4: Skip if same assignment already exists
                if (foundRowIndex >= 0 && oldPosCode.toUpperCase() === targetPosUpper) {
                    successCount++;
                    results.push({ lotCode, success: true, message: "Already assigned" });
                    console.log("SKIP: Same assignment already exists");
                    continue;
                }

                // Step 5: UPDATE or APPEND
                if (foundRowIndex >= 0) {
                    // UPDATE existing row
                    // Sheet rows are 1-indexed, allRows[i] corresponds to sheet row (i+1)
                    const sheetRowNumber = foundRowIndex + 1;
                    console.log(`UPDATE: Writing to sheet row ${sheetRowNumber}`);

                    await sheets.spreadsheets.values.update({
                        spreadsheetId: USER_SHEET_ID,
                        range: `${tab}!A${sheetRowNumber}:B${sheetRowNumber}`,
                        valueInputOption: "RAW",
                        requestBody: { values: [[lotCode, posCode]] },
                    });
                    console.log(`SUCCESS: Updated row ${sheetRowNumber}: ${lotCode} -> ${posCode}`);
                } else {
                    // APPEND new row
                    console.log("APPEND: Adding new row");
                    await sheets.spreadsheets.values.append({
                        spreadsheetId: USER_SHEET_ID,
                        range: `${tab}!A:B`,
                        valueInputOption: "RAW",
                        insertDataOption: "INSERT_ROWS",
                        requestBody: { values: [[lotCode, posCode]] },
                    });
                    console.log(`SUCCESS: Appended new row: ${lotCode} -> ${posCode}`);
                }

                // Step 6: Update LOTS sheet column O (Position)
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
                        console.log(`Updated ${updateData.length} rows in LOTS sheet column O`);
                    }
                } catch (lotsErr: any) {
                    console.error("Error updating LOTS sheet:", lotsErr.message);
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
                        action: foundRowIndex >= 0 ? "Cập nhật vị trí (QR)" : "Gán vị trí mới (QR)"
                    }
                });

                successCount++;
                results.push({ lotCode, success: true });

            } catch (err: any) {
                failCount++;
                results.push({ lotCode, success: false, error: err.message });
                console.error(`ERROR processing ${lotCode}:`, err.message);
            }
        }

        console.log(`\n=== SYNC COMPLETE: ${successCount} success, ${failCount} fail ===\n`);

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
