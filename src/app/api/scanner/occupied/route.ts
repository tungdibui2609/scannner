import { NextResponse } from "next/server";
import { google } from "googleapis";
import { ensureGoogleKeyFromB64 } from "@/lib/env";
import { LOTS_SHEET_RANGE, LOT_POSITIONS_SHEET_RANGE, USER_SHEET_ID } from "@/config/sheets";

ensureGoogleKeyFromB64();

async function getSheets(scopes: string[]) {
    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, "\n");
    if (!clientEmail || !privateKey) throw new Error("Thiếu GOOGLE_SERVICE_ACCOUNT_EMAIL/KEY trong biến môi trường");
    const jwt = new google.auth.JWT({ email: clientEmail, key: privateKey, scopes });
    return google.sheets({ version: "v4", auth: jwt });
}

export async function GET() {
    try {
        const sheets = await getSheets(["https://www.googleapis.com/auth/spreadsheets.readonly"]);
        const occupied: Record<string, string> = {};
        const mergedLots: Record<string, string> = {};

        try {
            // 1. Try fetching from LOTS sheet (column O for Position, Q for Status, R for MergedTo)
            // Use local range to safely access extended columns
            const resLots = await sheets.spreadsheets.values.get({ spreadsheetId: USER_SHEET_ID, range: "lot!A1:R" });
            const rows = resLots.data.values || [];
            const seen = new Set<string>();
            for (let i = 1; i < rows.length; i++) {
                const r = rows[i] || [];
                const lot = (r[0] || '').toString().trim();
                const pos = (r[14] || '').toString().trim();
                const status = (r[16] || '').toString().trim();
                const mergedTo = (r[17] || '').toString().trim();

                if (lot) {
                    // Collect occupied positions
                    if (pos && !seen.has(lot)) {
                        seen.add(lot);
                        occupied[pos] = lot;
                    }

                    // Collect merged lots
                    if (mergedTo || status === 'MERGED') {
                        mergedLots[lot] = mergedTo || "UNKNOWN";
                    }
                }
            }
        } catch (e) {
            console.error("Error fetching LOTS sheet", e);
        }

        // 2. Fallback/Supplement from lot_pos sheet if needed
        if (Object.keys(occupied).length === 0) {
            try {
                const res = await sheets.spreadsheets.values.get({ spreadsheetId: USER_SHEET_ID, range: LOT_POSITIONS_SHEET_RANGE });
                const rows = res.data.values || [];
                const [, ...data] = rows;
                data.forEach((r: any[]) => {
                    const lot = (r?.[0] || "").toString().trim();
                    const pos = (r?.[1] || "").toString().trim();
                    if (lot && pos) {
                        occupied[pos] = lot;
                    }
                });
            } catch (e) {
                console.error("Error fetching lot_pos sheet", e);
            }
        }

        return NextResponse.json({
            ok: true,
            occupied,
            mergedLots
        });
    } catch (error) {
        console.error("Failed to fetch occupied positions:", error);
        return NextResponse.json({ ok: false, message: "Failed to fetch occupied positions" }, { status: 500 });
    }
}
