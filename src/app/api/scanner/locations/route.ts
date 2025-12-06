import { NextResponse } from "next/server";
import { generateAllWarehouses } from "@/lib/locationCodes";

export async function GET() {
    try {
        // Generate all valid positions
        const allSlots = generateAllWarehouses();
        const codes = allSlots.map(s => s.code);

        return NextResponse.json({
            ok: true,
            locations: codes
        });
    } catch (error) {
        console.error("Failed to fetch locations:", error);
        return NextResponse.json({ ok: false, message: "Failed to fetch locations" }, { status: 500 });
    }
}
