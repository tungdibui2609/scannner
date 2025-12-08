/**
 * SCANNER SYNC API - COMPLETE COPY FROM QLK DASHBOARD
 * 
 * This is an EXACT copy of /api/locations/positions PUT method from QLK dashboard.
 * The only difference is it accepts batch items instead of single item.
 */

import { NextResponse } from "next/server";
import { google } from "googleapis";
import { ensureGoogleKeyFromB64, getGoogleCredentials } from "@/lib/env";
import { LOT_POSITIONS_SHEET_RANGE, LOTS_SHEET_RANGE, USER_SHEET_ID } from "@/config/sheets";
import { appendAuditLog } from "@/lib/auditLog";
import { getVNTimestamp } from "@/lib/vnDateTime";
import { cookies } from "next/headers";

ensureGoogleKeyFromB64();

function getTab(range: string) {
    return (range.split("!")[0] || "lot_pos");
}

async function getSheets(scopes: string[]) {
    const { email, key } = getGoogleCredentials();
    const jwt = new google.auth.JWT({ email, key, scopes });
    return google.sheets({ version: "v4", auth: jwt });
}

/**
 * Single item position update - EXACT COPY from QLK dashboard PUT method
 */
async function updateSinglePosition(
    sheets: any,
    lotCode: string,
    posCode: string,
    username: string,
    nameFromCookie: string
): Promise<{ ok: boolean; error?: string; oldPosCode?: string }> {
    const tab = getTab(LOT_POSITIONS_SHEET_RANGE);

    // Ensure tab exists
    const meta = await sheets.spreadsheets.get({ spreadsheetId: USER_SHEET_ID });
    const found = meta.data.sheets?.find((s: any) => s.properties?.title === tab);
    const sheetGid = found?.properties?.sheetId;

    if (typeof sheetGid !== "number") {
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

    // Read current data - EXACT COPY
    const cur = await sheets.spreadsheets.values.get({ spreadsheetId: USER_SHEET_ID, range: LOT_POSITIONS_SHEET_RANGE });
    const rows = cur.data.values || [];
    const header = rows[0] || ["LotCode", "PositionCode"];
    const data = rows.slice(1);

    // Find LOT row - EXACT COPY
    const idx = data.findIndex((r: any[]) => ((r?.[0] || "").toString().trim() === lotCode));
    const oldPosCode = idx >= 0 ? ((data[idx]?.[1] || '').toString().trim()) : '';

    console.log(`[SYNC] LOT=${lotCode}, pos=${posCode}, idx=${idx}, oldPos=${oldPosCode}`);

    // UPDATE or APPEND - EXACT COPY
    if (idx >= 0) {
        const absoluteRow = 2 + idx;
        console.log(`[SYNC] UPDATE row ${absoluteRow}`);
        await sheets.spreadsheets.values.update({
            spreadsheetId: USER_SHEET_ID,
            range: `${tab}!A${absoluteRow}:B${absoluteRow}`,
            valueInputOption: "RAW",
            requestBody: { values: [[lotCode, posCode]] },
        });
    } else {
        console.log(`[SYNC] APPEND new row`);
        if (!rows.length) {
            await sheets.spreadsheets.values.update({
                spreadsheetId: USER_SHEET_ID,
                range: `${tab}!A1:B1`,
                valueInputOption: "RAW",
                requestBody: { values: [[...header]] },
            });
        }
        await sheets.spreadsheets.values.append({
            spreadsheetId: USER_SHEET_ID,
            range: `${tab}!A:B`,
            valueInputOption: "RAW",
            insertDataOption: "INSERT_ROWS",
            requestBody: { values: [[lotCode, posCode]] },
        });
    }

    // Update LOTS sheet column O - EXACT COPY
    try {
        const tabLots = (LOTS_SHEET_RANGE.split('!')[0] || 'lot');
        const resLots = await sheets.spreadsheets.values.get({ spreadsheetId: USER_SHEET_ID, range: `${tabLots}!A:A` });
        const rowsLots = resLots.data.values || [];
        const toUpdateRows: number[] = [];
        for (let i = 1; i < rowsLots.length; i++) {
            const r = rowsLots[i] || [];
            if (((r[0] || '').toString() === lotCode)) toUpdateRows.push(i + 1);
        }
        if (toUpdateRows.length) {
            const dataReq = toUpdateRows.map((row) => ({ range: `${tabLots}!O${row}:O${row}`, values: [[posCode]] }));
            await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: USER_SHEET_ID, requestBody: { valueInputOption: 'RAW', data: dataReq } });
        }
    } catch { }

    // Audit log
    const auditDetails: any = { lotCode, posCode };
    if (oldPosCode && oldPosCode !== posCode) {
        auditDetails.oldPosCode = oldPosCode;
    }
    appendAuditLog({ ts: getVNTimestamp(), username, name: nameFromCookie || undefined, method: "PUT", path: "/api/locations/positions", details: auditDetails });

    return { ok: true, oldPosCode };
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { items } = body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return NextResponse.json({ error: "No items to sync" }, { status: 400 });
        }

        console.log("=== SCANNER SYNC START ===");
        console.log("Total items:", items.length);

        const sheets = await getSheets(["https://www.googleapis.com/auth/spreadsheets"]);

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

        // Process ONE BY ONE using the EXACT same logic as QLK dashboard
        for (const item of items) {
            const lotCode = (item.id || "").toString().trim();
            const posCode = (item.position || "").toString().trim();

            if (!lotCode || !posCode) {
                failCount++;
                results.push({ lotCode, success: false, error: "Missing data" });
                continue;
            }

            try {
                const result = await updateSinglePosition(sheets, lotCode, posCode, username, nameFromCookie);
                if (result.ok) {
                    successCount++;
                    results.push({ lotCode, success: true, oldPosCode: result.oldPosCode });
                } else {
                    failCount++;
                    results.push({ lotCode, success: false, error: result.error });
                }
            } catch (err: any) {
                failCount++;
                results.push({ lotCode, success: false, error: err.message });
                console.error(`[SYNC] ERROR for ${lotCode}:`, err.message);
            }
        }

        console.log(`=== SYNC DONE: ${successCount} OK, ${failCount} FAIL ===`);

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
