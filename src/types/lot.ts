// Basic types needed for products if not imported from shared libs
export interface Product {
    code: string;
    name: string;
    group: string;
    uomSmall: string;
    uomMedium: string;
    uomLarge: string;
    ratioSmallToMedium: string;
    ratioMediumToLarge: string;
    spec: string;
    description?: string;
    imageUrl?: string;
    imageUrl2?: string;
    imageUrl3?: string;
}

export type ProductUOM = {
    unit: string;
    ratio: number;
    level: "small" | "medium" | "large";
};

export type LotItem = {
    lotCode: string;
    productCode: string;
    productName: string;
    quantity: number;
    unit: string;
    productionDate: string; // ISO or DD/MM/YYYY
    expiryDate: string;     // ISO or DD/MM/YYYY
    position: string;
    status: string;
    mergedTo?: string; // If merged, this points to new LOT
    notes?: string;
    // ... other fields
};

// ... other types
