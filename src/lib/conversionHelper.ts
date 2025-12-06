// Helper functions for unit conversion when creating outbound documents

export interface ConversionCheckResult {
    needsConversion: boolean;
    productCode: string;
    productName: string;
    requestedQty: number;
    requestedUnit: string;
    currentBalance: number;
    conversionScenarios?: any[];
    recommendedScenario?: any;
    allBalances?: { [unit: string]: number };
    shortage?: number;
    error?: string;
}


/**
 * Normalize unit names for comparison
 */
export function normalizeUnit(unit: string): string {
    return (unit || "").toString().trim().toLowerCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}+/gu, "");
}

/**
 * Check if a single line needs unit conversion
 */
export async function checkLineNeedsConversion(
    productCode: string,
    warehouse: string,
    requestedQty: number,
    requestedUnit: string
): Promise<ConversionCheckResult> {
    try {
        const res = await fetch("/api/outbound/check-conversion", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                productCode,
                warehouse,
                requestedQty,
                requestedUnit,
            }),
        });

        const data = await res.json();

        if (!data.ok) {
            return {
                needsConversion: false,
                productCode,
                productName: "",
                requestedQty,
                requestedUnit,
                currentBalance: 0,
                error: data.error || "Lỗi không xác định",
            };
        }

        if (data.sufficient) {
            return {
                needsConversion: false,
                productCode,
                productName: data.productName,
                requestedQty,
                requestedUnit,
                currentBalance: data.currentBalance,
            };
        }

        if (data.canConvert) {
            return {
                needsConversion: true,
                productCode,
                productName: data.productName,
                requestedQty,
                requestedUnit,
                currentBalance: data.currentBalance,
                conversionScenarios: data.conversionScenarios,
                recommendedScenario: data.recommendedScenario,
                allBalances: data.allBalances,
                shortage: data.shortage,
            };
        }

        // Can't convert
        return {
            needsConversion: false,
            productCode,
            productName: data.productName,
            requestedQty,
            requestedUnit,
            currentBalance: data.currentBalance,
            allBalances: data.allBalances,
            shortage: data.shortage,
            error: data.message || "Không đủ tồn kho ngay cả khi chuyển đổi",
        };
    } catch (e: any) {
        return {
            needsConversion: false,
            productCode,
            productName: "",
            requestedQty,
            requestedUnit,
            currentBalance: 0,
            error: e?.message || "Lỗi khi kiểm tra chuyển đổi",
        };
    }
}

/**
 * Execute conversion by creating necessary inbound/outbound documents
 */
export async function executeConversion(
    scenario: any,
    productCode: string,
    productName: string,
    warehouse: string,
    date: string,
    createdBy: string
): Promise<{ success: boolean; error?: string; codes?: string[] }> {
    try {
        const createdCodes: string[] = [];

        // Execute each step in the scenario
        for (let i = 0; i < scenario.steps.length; i++) {
            const step = scenario.steps[i];

            // Skip the final export step (that's what the user wants to do)
            // We only execute internal conversion steps
            if (i === scenario.steps.length - 1 && step.action === "export") {
                continue;
            }

            const isExport = step.action === "export";
            const endpoint = isExport ? "/api/outbound" : "/api/inbound";

            const now = new Date();
            const hh = String(now.getHours()).padStart(2, "0");
            const mm = String(now.getMinutes()).padStart(2, "0");
            const time = `${hh}:${mm}`;

            const payload = {
                date,
                time,
                warehouse,
                type: "Chuyển đổi đơn vị", // Special type for internal conversions
                createdBy,
                user: createdBy,
                description: `[Tự động] ${step.description}`,
                source: "Auto Conversion",
                lines: [
                    {
                        code: productCode,
                        productName: productName,
                        qty: step.qty,
                        unit: step.unit,
                        memo: `Chuyển đổi tự động - Bước ${i + 1}/${scenario.steps.length - 1}`,
                    },
                ],
                logEntry: `Tự động tạo phiếu chuyển đổi đơn vị - ${step.description}`,
            };

            const res = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            const data = await res.json();

            if (!data.ok) {
                throw new Error(
                    `Lỗi khi tạo phiếu ${isExport ? "xuất" : "nhập"}: ${data.error || "Unknown error"}`
                );
            }

            createdCodes.push(data.doc?.code || "");
        }

        return {
            success: true,
            codes: createdCodes,
        };
    } catch (e: any) {
        return {
            success: false,
            error: e?.message || "Lỗi khi thực hiện chuyển đổi",
        };
    }
}
