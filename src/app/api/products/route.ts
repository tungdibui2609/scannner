import { NextResponse } from "next/server";
import { PRODUCTS_SHEET_RANGE, USER_SHEET_ID, PRODUCTS_DISABLED_CODES_RANGE } from "@/config/sheets";
import { listProductsFromSheet, listDisabledCodes } from "@/lib/googleSheets";

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const includeDisabled = searchParams.get("includeDisabled");
        const [products, disabled] = await Promise.all([
            listProductsFromSheet(USER_SHEET_ID, PRODUCTS_SHEET_RANGE),
            listDisabledCodes(USER_SHEET_ID, PRODUCTS_DISABLED_CODES_RANGE).catch(() => [] as string[]),
        ]);
        const disabledSet = new Set(disabled.map((c) => c.toLowerCase()));
        if (includeDisabled) {
            const merged = products.map((p: any) => ({ ...p, disabled: disabledSet.has((p.code || "").toLowerCase()) }));
            return NextResponse.json({ ok: true, products: merged });
        }
        const visible = products.filter((p: any) => !disabledSet.has((p.code || "").toLowerCase()));
        return NextResponse.json({ ok: true, products: visible });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || "Lỗi không xác định" }, { status: 500 });
    }
}
