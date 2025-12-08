
import { NextResponse } from "next/server";
import { google } from "googleapis";
import { ensureGoogleKeyFromB64, getGoogleCredentials } from "@/lib/env";
import { LOTS_SHEET_RANGE, DELETED_LOTS_SHEET_RANGE, USER_SHEET_ID } from "@/config/sheets";
import { appendAuditLog } from "@/lib/auditLog";
import { cookies } from "next/headers";
import { getVNTimestamp } from "@/lib/vnDateTime";
import { normalizeUnit } from "@/lib/conversionHelper";

ensureGoogleKeyFromB64();

const LOTS_TAB = LOTS_SHEET_RANGE.split("!")[0];
const DELETED_LOTS_TAB = DELETED_LOTS_SHEET_RANGE.split("!")[0];

async function getSheets(scopes: string[]) {
    const { email, key } = getGoogleCredentials();
    const jwt = new google.auth.JWT({ email, key, scopes });
    return google.sheets({ version: "v4", auth: jwt });
}

async function getSheetIdByTitle(sheets: any, spreadsheetId: string, title: string): Promise<number> {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const found = meta.data.sheets?.find((s: any) => s.properties?.title === title);
    if (!found?.properties?.sheetId && found?.properties?.sheetId !== 0) throw new Error(`Không tìm thấy sheet: ${title}`);
    return found.properties.sheetId as number;
}

// Helper to parse Vietnamese number format (e.g., "17,5" or "1.234,5")
function parseVnNumber(str: string | number | undefined | null): number {
    if (str === undefined || str === null || str === "") return 0;
    if (typeof str === 'number') return str;
    // Convert to string and trim
    const s = str.toString().trim();
    // Remove dots (thousand separators) and replace comma with dot
    const clean = s.replace(/\./g, "").replace(",", ".");
    const val = Number(clean);
    return isNaN(val) ? 0 : val;
}

// Helper to get product info for conversion
async function getProductInfo(sheets: any, productCode: string) {
    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: USER_SHEET_ID,
            range: "Products!A2:M", // Assuming Products sheet structure
        });
        const rows = res.data.values || [];
        const product = rows.find((r: any[]) => r[0] === productCode);
        if (!product) return null;

        // Map based on assumed structure:
        // A=Code, B=Name, ..., I=UOM Small, J=UOM Medium, K=UOM Large, L=Ratio S-M, M=Ratio M-L
        // Adjust indices based on actual Products sheet if needed. 
        // Based on previous context (Split Lot), we need these fields.
        // Let's assume standard structure or try to read header if possible.
        // For now, using indices commonly used in this project or safe defaults.
        // Re-checking `useProducts` hook logic would be ideal but for backend we can just read all and map.

        return {
            code: product[0],
            uomSmall: product[8],
            uomMedium: product[9],
            uomLarge: product[10],
            ratioSmallToMedium: product[11],
            ratioMediumToLarge: product[12],
        };
    } catch (e) {
        console.error("Error fetching product info:", e);
        return null;
    }
}

/**
 * POST /api/Lots/export
 * Xuất LOT khỏi kho: lưu vào deletelot, xóa khỏi lot sheet (hoặc cập nhật số lượng)
 * Body: { 
 *   lotCode: string, 
 *   deletedBy?: string, 
 *   mode?: 'FULL' | 'PARTIAL', 
 *   reason?: string,
 *   items?: Array<{ lineIndex: number, quantity: number, unit: string }> // For PARTIAL
 * }
 */
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const lotCode = (body?.lotCode || "").toString();
        const deletedBy = (body?.deletedBy || "").toString();
        const mode = (body?.mode || "FULL").toString(); // FULL or PARTIAL
        const reason = (body?.reason || "").toString();
        const itemsToExport = body?.items || []; // List of items to export in PARTIAL mode

        if (!lotCode) {
            return NextResponse.json({ error: "LOT_CODE_REQUIRED" }, { status: 400 });
        }

        const sheets = await getSheets(["https://www.googleapis.com/auth/spreadsheets"]);

        // 1. Đọc tất cả dữ liệu LOT
        const resLots = await sheets.spreadsheets.values.get({
            spreadsheetId: USER_SHEET_ID,
            range: LOTS_SHEET_RANGE,
        });
        const rowsLots: any[][] = resLots.data.values || [];

        if (rowsLots.length <= 1) {
            return NextResponse.json({ error: "LOT_NOT_FOUND" }, { status: 404 });
        }

        // 2. Tìm tất cả dòng của LOT này
        const lotRows: any[][] = [];
        const lotRowIndexes: number[] = [];
        for (let i = 1; i < rowsLots.length; i++) {
            const code = (rowsLots[i]?.[0] || "").toString();
            if (code === lotCode) {
                lotRows.push(rowsLots[i]);
                lotRowIndexes.push(i);
            }
        }

        if (!lotRows.length) {
            return NextResponse.json({ error: "LOT_NOT_FOUND" }, { status: 404 });
        }

        const deletedAt = getVNTimestamp();
        let deletedLotsRows: any[][] = [];
        let updatedLotRows: any[][] = []; // For PARTIAL mode update
        let hasUpdates = false;

        if (mode === "PARTIAL") {
            if (!itemsToExport.length) {
                return NextResponse.json({ error: "NO_ITEMS_TO_EXPORT" }, { status: 400 });
            }

            // We need product info for conversion
            // Optimization: Fetch all products once or fetch needed ones. 
            // Since we are in a loop, let's fetch all products once to be safe and efficient.
            const resProducts = await sheets.spreadsheets.values.get({
                spreadsheetId: USER_SHEET_ID,
                range: "Products!A2:M",
            });
            const productRows = resProducts.data.values || [];
            const productsMap = new Map();
            productRows.forEach((r: any[]) => {
                if (r[0]) {
                    productsMap.set(r[0], {
                        uomSmall: r[3],
                        uomMedium: r[4],
                        uomLarge: r[5],
                        ratioSmallToMedium: r[6],
                        ratioMediumToLarge: r[7],
                    });
                }
            });

            // Process each line of the LOT
            // We map over lotRows and check if it needs to be modified
            // Note: itemsToExport should reference the index within lotRows (0-based relative to the lot)

            // Deep copy lotRows to modify
            updatedLotRows = lotRows.map(row => [...row]);

            for (const item of itemsToExport) {
                const lineIndex = item.lineIndex;
                if (lineIndex < 0 || lineIndex >= updatedLotRows.length) continue;

                const currentRow = updatedLotRows[lineIndex];
                const currentQty = parseVnNumber(currentRow[10]);
                const currentUnit = currentRow[11] || "";
                const productCode = currentRow[1];

                const exportQty = parseVnNumber(item.quantity);
                const exportUnit = item.unit || currentUnit;

                if (exportQty <= 0) continue;

                // Conversion Logic
                let consumedCurrent = exportQty;
                let remainderInTarget = 0;
                const product = productsMap.get(productCode);

                if (normalizeUnit(exportUnit) !== normalizeUnit(currentUnit) && product) {
                    const getRatioToSmall = (unit: string) => {
                        const nUnit = normalizeUnit(unit);
                        if (nUnit === normalizeUnit(product.uomSmall || "")) return 1;
                        const ratioSmallToMedium = parseVnNumber(product.ratioSmallToMedium);
                        if (nUnit === normalizeUnit(product.uomMedium || "")) return ratioSmallToMedium;
                        const ratioMediumToLarge = parseVnNumber(product.ratioMediumToLarge);
                        if (nUnit === normalizeUnit(product.uomLarge || "")) return ratioMediumToLarge * ratioSmallToMedium;
                        return 0;
                    };

                    const currentRatio = getRatioToSmall(currentUnit);
                    const targetRatio = getRatioToSmall(exportUnit);

                    if (currentRatio > 0 && targetRatio > 0) {
                        const splitInSmall = exportQty * targetRatio;
                        consumedCurrent = Math.ceil(splitInSmall / currentRatio);
                        const consumedInSmall = consumedCurrent * currentRatio;
                        const remainderInSmall = consumedInSmall - splitInSmall;
                        remainderInTarget = remainderInSmall / targetRatio;
                    }
                }

                if (consumedCurrent > currentQty) {
                    throw new Error(`Số lượng xuất (${consumedCurrent} ${currentUnit}) lớn hơn tồn kho (${currentQty} ${currentUnit})`);
                }

                // 1. Add to deletedLotsRows (The amount exported)
                // We construct a row that looks like the original but with exported qty/unit
                const exportRow = [...currentRow];
                exportRow[10] = exportQty; // Quantity
                exportRow[11] = exportUnit; // Unit

                // Ensure row has enough columns
                while (exportRow.length < 16) exportRow.push("");
                exportRow.push(deletedAt, deletedBy, reason); // Q, R, S
                deletedLotsRows.push(exportRow);

                // 2. Update currentRow (Reduce qty)
                const newQty = currentQty - consumedCurrent;
                currentRow[10] = newQty;

                // 3. If remainder, add new line to updatedLotRows
                if (remainderInTarget > 0) {
                    const remainderRow = [...currentRow]; // Copy from modified current row (inherits most props)
                    remainderRow[10] = remainderInTarget;
                    remainderRow[11] = exportUnit; // Remainder is in the export unit (usually smaller)
                    updatedLotRows.push(remainderRow);
                }

                hasUpdates = true;
            }

            // Filter out rows with 0 quantity (unless we want to keep empty lines? No, usually remove)
            updatedLotRows = updatedLotRows.filter(row => parseVnNumber(row[10]) > 0);

            // If all rows are gone, it becomes a full delete
            if (updatedLotRows.length === 0) {
                // Fallback to full delete logic if needed, but here we just proceed with empty updatedLotRows
                // which means we delete old rows and add nothing back.
            }

        } else {
            // FULL MODE
            deletedLotsRows = lotRows.map((row) => {
                const fullRow = [...row];
                while (fullRow.length < 16) fullRow.push("");
                // Thêm Q=deletedAt, R=deletedBy, S=reason
                return [...fullRow, deletedAt, deletedBy, reason];
            });
        }

        // 3. Write to deletelot sheet
        if (deletedLotsRows.length > 0) {
            await sheets.spreadsheets.values.append({
                spreadsheetId: USER_SHEET_ID,
                range: DELETED_LOTS_TAB + "!A:S",
                valueInputOption: "RAW",
                requestBody: { values: deletedLotsRows },
            });
        }

        // 4. Update LOT sheet
        // Strategy: Delete OLD rows, then (if PARTIAL and has remaining) Append NEW rows
        // This is safer than trying to update in place because row counts might change (remainder added)

        const lotsSheetId = await getSheetIdByTitle(sheets, USER_SHEET_ID, LOTS_TAB);

        // Delete old rows
        const deleteRequests: any[] = [];
        // Sort descending to delete from bottom up
        lotRowIndexes.sort((a, b) => b - a).forEach((idx) => {
            deleteRequests.push({
                deleteDimension: {
                    range: {
                        sheetId: lotsSheetId,
                        dimension: "ROWS",
                        startIndex: idx,
                        endIndex: idx + 1,
                    },
                },
            });
        });

        if (deleteRequests.length) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: USER_SHEET_ID,
                requestBody: { requests: deleteRequests },
            });
        }

        // If PARTIAL and we have remaining items, append them back
        if (mode === "PARTIAL" && updatedLotRows.length > 0) {
            await sheets.spreadsheets.values.append({
                spreadsheetId: USER_SHEET_ID,
                range: LOTS_SHEET_RANGE,
                valueInputOption: "RAW",
                requestBody: { values: updatedLotRows },
            });
        }

        // Ghi audit log
        let username = deletedBy;
        let nameFromCookie = "";
        try {
            const store = await cookies();
            const c = store.get("wms_user")?.value;
            if (c) {
                const v = JSON.parse(decodeURIComponent(c));
                if (!username) username = (v?.username || "").toString();
                nameFromCookie = (v?.name || "").toString();
            }
        } catch { }

        // Build detailed product list for audit log
        const productDetails = deletedLotsRows.map((row: any[]) => {
            const code = (row?.[1] || "").toString();
            const name = (row?.[2] || "").toString();
            const qty = (row?.[10] || "").toString();
            const unit = (row?.[11] || "").toString();
            if (!code) return "";
            return `${code} (${name}): ${qty} ${unit}`;
        }).filter(Boolean);

        appendAuditLog({
            ts: deletedAt,
            username: username,
            name: nameFromCookie || undefined,
            method: "POST",
            path: "/api/lots/export",
            details: {
                lotCode,
                mode,
                reason,
                deletedRows: deletedLotsRows.length,
                products: productDetails.join("; ")
            }
        });

        return NextResponse.json({
            ok: true,
            message: mode === "FULL" ? "Đã xuất toàn bộ LOT" : "Đã xuất một phần LOT",
            deletedRows: deletedLotsRows.length
        });

    } catch (err: any) {
        console.error("Export LOT error:", err);
        return NextResponse.json(
            { error: err?.message || "EXPORT_LOT_FAILED" },
            { status: 500 }
        );
    }
}
