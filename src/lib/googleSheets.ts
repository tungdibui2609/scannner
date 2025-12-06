import { google } from "googleapis";
import { ensureGoogleKeyFromB64 } from "./env";
import { PERMISSIONS_SHEET_RANGE } from "@/config/sheets";
import { Product } from "@/types/lot";

ensureGoogleKeyFromB64();

export async function getSheets(scopes: string[]) {
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, "\n");
    if (!email || !key) {
        console.error("Missing Google Env Vars:", { email: !!email, key: !!key });
        throw new Error("Thiếu GOOGLE_SERVICE_ACCOUNT_EMAIL/KEY");
    }
    const jwt = new google.auth.JWT({ email, key, scopes });
    return google.sheets({ version: "v4", auth: jwt });
}

export async function getSheetRows(sheetId: string, range: string) {
    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, "\n");
    if (!clientEmail || !privateKey) {
        throw new Error("Thiếu GOOGLE_SERVICE_ACCOUNT_EMAIL/KEY trong biến môi trường");
    }
    const scopes = ["https://www.googleapis.com/auth/spreadsheets.readonly"];
    const jwt = new google.auth.JWT({
        email: clientEmail,
        key: privateKey,
        scopes,
    });
    const sheets = google.sheets({ version: "v4", auth: jwt });
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range });
    return res.data.values || [];
}

// User & Auth Types
export type SheetUser = {
    username: string;
    password: string;
    name?: string;
    role?: string; // chucvu (F)
    roles?: string[]; // phân quyền (D)
    status?: string;
    avatar?: string; // avatar URL (K)
};

export type RolePermission = {
    role: string;
    allowedPaths: string[];
    redirectTo: string;
    blockedPaths: string[];
};

// Functions

// Helper: column index to letter
function colIndexToLetter(index: number): string {
    let n = index + 1;
    let s = "";
    while (n > 0) {
        const m = (n - 1) % 26;
        s = String.fromCharCode(65 + m) + s;
        n = Math.floor((n - 1) / 26);
    }
    return s;
}

export async function getRolePermissions(sheetId: string): Promise<RolePermission[]> {
    const rows = await getSheetRows(sheetId, PERMISSIONS_SHEET_RANGE);
    if (!rows.length) return [];
    const [, ...data] = rows; // Skip header

    return data.map(row => ({
        role: (row[0] || "").toString().trim(),
        allowedPaths: (row[1] || "").toString().split(",").map((p: string) => p.trim()).filter(Boolean),
        redirectTo: (row[2] || "").toString().trim(),
        blockedPaths: (row[3] || "").toString().split(",").map((p: string) => p.trim()).filter(Boolean)
    })).filter(p => p.role);
}

export async function findUserWithRow(sheetId: string, range: string, username: string): Promise<{ user: SheetUser; rowIndex: number; header: string[] } | null> {
    const rows = await getSheetRows(sheetId, range);
    if (!rows.length) return null;
    const [header, ...data] = rows;
    const idxUser = 1; // B
    const idxPass = 2; // C
    const idxRoles = 3; // D
    const idxName = 4; // E
    const idxChucVu = 5; // F
    const idxStatus = header.findIndex((h: string) => /status|tr[ạa]ng\s*th[aá]i/i.test(h));
    const idxAvatar = header.findIndex((h: string) => /avatar|ảnh\s*đại\s*diện/i.test(h));
    const avatarIdx = idxAvatar >= 0 ? idxAvatar : 10; // K default

    if (idxUser < 0 || idxPass < 0) return null;

    for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const u = (row[idxUser] || "").toString().trim();
        if (u.toLowerCase() === username.toLowerCase()) {
            const user: SheetUser = {
                username: u,
                password: (row[idxPass] || "").toString(),
                name: row.length > idxName ? (row[idxName] || "").toString() : undefined,
                role: row.length > idxChucVu ? (row[idxChucVu] || "").toString() : undefined,
                roles: row.length > idxRoles && row[idxRoles] ? (row[idxRoles] as string).toString().split(/\s*,\s*/).filter(Boolean) : [],
                status: idxStatus >= 0 ? (row[idxStatus] || "").toString() : undefined,
                avatar: row.length > avatarIdx && row[avatarIdx] ? (row[avatarIdx] || "").toString() : undefined,
            };
            // rowIndex (1-based): header(1) + i(0-based) + 1 => i + 2
            return { user, rowIndex: i + 2, header };
        }
    }
    return null;
}

export async function updateUserStatus(sheetId: string, tabName: string, header: string[], rowIndex: number, status: string) {
    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, "\n");
    if (!clientEmail || !privateKey) {
        throw new Error("Thiếu GOOGLE_SERVICE_ACCOUNT_EMAIL/KEY trong biến môi trường");
    }
    const scopes = ["https://www.googleapis.com/auth/spreadsheets"];
    const jwt = new google.auth.JWT({ email: clientEmail, key: privateKey, scopes });
    const sheets = google.sheets({ version: "v4", auth: jwt });

    let colIdx = header.findIndex((h: string) => /status/i.test(h));
    if (colIdx < 0) colIdx = 7; // H
    const colLetter = colIndexToLetter(colIdx);
    const range = `${tabName}!${colLetter}${rowIndex}`;

    await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[status]] },
    });
}

export async function updateUserLastSeen(sheetId: string, tabName: string, header: string[], rowIndex: number, isoValue: string) {
    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, "\n");
    if (!clientEmail || !privateKey) {
        throw new Error("Thiếu GOOGLE_SERVICE_ACCOUNT_EMAIL/KEY trong biến môi trường");
    }
    const scopes = ["https://www.googleapis.com/auth/spreadsheets"];
    const jwt = new google.auth.JWT({ email: clientEmail, key: privateKey, scopes });
    const sheets = google.sheets({ version: "v4", auth: jwt });

    let colIdx = header.findIndex((h: string) => /last\s*seen|lastseen|last\s*active|last\s*activity/i.test(h));
    if (colIdx < 0) colIdx = 8; // I
    const colLetter = colIndexToLetter(colIdx);
    const range = `${tabName}!${colLetter}${rowIndex}`;

    await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[isoValue]] },
    });
}

export function formatVNDateTime(d = new Date()) {
    const tz = "Asia/Ho_Chi_Minh";
    const parts = new Intl.DateTimeFormat("vi-VN", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    })
        .formatToParts(d)
        .reduce<Record<string, string>>((acc, p) => {
            if (p.type !== "literal") acc[p.type] = p.value;
            return acc;
        }, {});
    return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
}

// Add listProductsFromSheet
export async function listProductsFromSheet(sheetId: string, range: string): Promise<Product[]> {
    const rows = await getSheetRows(sheetId, range);
    if (!rows.length) return [];
    const [, ...data] = rows;
    // Cố định cột A..M
    const idxA = 0, idxB = 1, idxC = 2, idxD = 3, idxE = 4, idxF = 5, idxG = 6, idxH = 7, idxI = 8, idxJ = 9, idxK = 10, idxL = 11, idxM = 12;
    const out: Product[] = [];
    for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const code = (row[idxA] || "").toString().trim();
        if (!code) continue; // bỏ dòng trống
        const p: any = {
            code,
            name: (row[idxB] || "").toString().trim(),
            group: (row[idxC] || "").toString().trim(),
            uomSmall: (row[idxD] || "").toString().trim(),
            uomMedium: (row[idxE] || "").toString().trim(),
            uomLarge: (row[idxF] || "").toString().trim(),
            ratioSmallToMedium: (row[idxG] || "").toString().trim(),
            ratioMediumToLarge: (row[idxH] || "").toString().trim(),
            spec: row.length > idxI ? (row[idxI] || "").toString() : "",
            description: row.length > idxJ ? (row[idxJ] || "").toString() : "",
            imageUrl: row.length > idxK ? (row[idxK] || "").toString() : "",
            imageUrl2: row.length > idxL ? (row[idxL] || "").toString() : "",
            imageUrl3: row.length > idxM ? (row[idxM] || "").toString() : "",
        };
        // Thêm metadata rowIndex (1-based) để hỗ trợ cập nhật/xóa (header ở hàng 1, data đầu tiên ở hàng 2)
        (p as any).rowIndex = i + 2;
        out.push(p as Product);
    }
    return out;
}

// Add listDisabledCodes
export async function listDisabledCodes(sheetId: string, range: string): Promise<string[]> {
    const rows = await getSheetRows(sheetId, range);
    const vals = rows.map((r: any[]) => (r?.[0] || "").toString().trim()).filter(Boolean);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of vals) { const key = v.toLowerCase(); if (!seen.has(key)) { seen.add(key); out.push(v); } }
    return out;
}
