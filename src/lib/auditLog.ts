import { google } from "googleapis";
import { ensureGoogleKeyFromB64 } from "@/lib/env";
import { AUDIT_LOG_SHEET_RANGE, USER_SHEET_ID } from "@/config/sheets";

ensureGoogleKeyFromB64();

function getTab(range: string) {
    return range.split("!")[0];
}

async function getSheets(scopes: string[]) {
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, "\n");
    if (!email || !key) throw new Error("Thiếu GOOGLE_SERVICE_ACCOUNT_EMAIL/KEY");
    const jwt = new google.auth.JWT({ email, key, scopes });
    return google.sheets({ version: "v4", auth: jwt });
}

export type AuditLogItem = {
    ts: string; // ISO time
    username: string;
    name?: string;
    method: string;
    path: string;
    query?: string;
    ip?: string;
    ua?: string;
    details?: any;
};

export async function appendAuditLog(item: AuditLogItem) {
    try {
        const sheets = await getSheets(["https://www.googleapis.com/auth/spreadsheets"]);
        const tab = getTab(AUDIT_LOG_SHEET_RANGE);
        const row = [
            item.ts,
            item.username || "",
            item.name || "",
            item.method || "",
            item.path || "",
            item.query || "",
            item.ip || "",
            item.ua || "",
            JSON.stringify(item.details || {}),
        ];
        await sheets.spreadsheets.values.append({
            spreadsheetId: USER_SHEET_ID,
            range: `${tab}!A:I`,
            valueInputOption: "RAW",
            insertDataOption: "INSERT_ROWS",
            requestBody: { values: [row] },
        });
    } catch (e) {
        // swallow errors to avoid breaking primary action
        console.error("appendAuditLog failed", e);
    }
}

export async function listAuditLogs(limit = 100) {
    const sheets = await getSheets(["https://www.googleapis.com/auth/spreadsheets.readonly"]);
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: USER_SHEET_ID, range: AUDIT_LOG_SHEET_RANGE });
    const rows = res.data.values || [];
    const data = rows.slice(1).reverse().slice(0, limit);
    return data.map((r) => ({
        ts: r?.[0] || "",
        username: r?.[1] || "",
        name: r?.[2] || "",
        method: r?.[3] || "",
        path: r?.[4] || "",
        query: r?.[5] || "",
        ip: r?.[6] || "",
        ua: r?.[7] || "",
        details: (() => { try { return JSON.parse(r?.[8] || "{}"); } catch { return {}; } })(),
    }));
}
