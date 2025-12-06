import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { ensureGoogleKeyFromB64 } from "@/lib/env";
import { LOTS_SHEET_RANGE, USER_SHEET_ID } from "@/config/sheets";

ensureGoogleKeyFromB64();

async function getSheets(scopes: string[]) {
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\n/g, "\n");
    if (!email || !key) throw new Error("Thiếu GOOGLE_SERVICE_ACCOUNT_EMAIL/KEY");
    const jwt = new google.auth.JWT({ email, key, scopes });
    return google.sheets({ version: "v4", auth: jwt });
}

// Using a loose type for context to be compatible across Next.js versions
export async function GET(_req: NextRequest, context: any) {
    try {
        const lotCode = decodeURIComponent((context?.params?.code || "")).trim();
        if (!lotCode) return NextResponse.json({ items: [] });
        const sheets = await getSheets(["https://www.googleapis.com/auth/spreadsheets.readonly"]);
        const res = await sheets.spreadsheets.values.get({ spreadsheetId: USER_SHEET_ID, range: LOTS_SHEET_RANGE });
        const rows = res.data.values || [];
        if (rows.length <= 1) return NextResponse.json({ items: [] });
        const [, ...data] = rows;
        const items = data
            .map((r: any[]) => ({
                lotCode: (r?.[0] || "").toString(),
                productCode: (r?.[1] || "").toString(),
                productName: (r?.[2] || "").toString(),
                productType: (r?.[3] || "").toString() || undefined,
                peelDate: (r?.[4] || "").toString() || undefined,
                packDate: (r?.[5] || "").toString() || undefined,
                qc: (r?.[6] || "").toString() || undefined,
                quantity: Number(((r?.[10] || "").toString()).replace(/,/g, ".")) || 0,
                unit: (r?.[11] || "").toString() || undefined,
                imageUrl: (r?.[13] || "").toString() || undefined,
                shots: r?.[12] != null ? Number(((r?.[12] || "").toString()).replace(/,/g, ".")) || 0 : undefined,
            }))
            .filter((x) => x.lotCode === lotCode);

        // Extract header info from first item (all items share same LOT header)
        const header = items.length > 0 ? {
            peelDate: items[0].peelDate,
            packDate: items[0].packDate,
            qc: items[0].qc,
        } : undefined;

        return NextResponse.json({ items, header });
    } catch (err: any) {
        return NextResponse.json({ error: err?.message || "GET_LOT_LINES_FAILED" }, { status: 500 });
    }
}
