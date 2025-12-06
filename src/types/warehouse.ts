export interface LevelData {
    id: string;
    levelNumber: number;
    total: number;
    used: number;
    product?: string; // Dominant product
    isMixed?: boolean; // True if contains mixed products
    items: { position: number; code: string; name: string; quantity: string; unit: string }[]; // Per-slot products
}

export interface RackData {
    id: string;
    name: string;
    levels: LevelData[];
}

export interface ZoneData {
    id: string;
    name: string;
    racks: RackData[];
    hall?: {
        total: number;
        used: number;
        items: LevelData['items'];
    };
}
