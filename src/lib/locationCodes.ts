export type Zone = 'A' | 'B' | 'S'; // S = Sảnh
export type WarehouseId = 1 | 2 | 3;

export type Slot = {
    warehouse: WarehouseId;
    zone: Zone;
    row?: number;   // Dãy (D)
    level?: number; // Tầng (T)
    pos: number;    // Pallet index (PL)
    code: string;   // Canonical code
    capacity: number;
};

// Format: A-K3D4T2.PL6
// For Sảnh: S-K3.PL12
export function formatCode(s: Omit<Slot, 'code'>): string {
    if (s.zone === 'S') {
        return `S-K${s.warehouse}.PL${s.pos}`;
    }
    const d = s.row ?? 0;
    const t = s.level ?? 0;
    return `${s.zone}-K${s.warehouse}D${d}T${t}.PL${s.pos}`;
}

const reRack = /^(A|B)-K(\d+)D(\d+)T(\d+)\.PL(\d+)$/i;
const reHall = /^S-K(\d+)\.PL(\d+)$/i;

export function parseCode(code: string): Slot | null {
    const s = (code || '').trim();
    let m = s.match(reRack);
    if (m) {
        const zone = (m[1].toUpperCase() as Zone);
        const w = Number(m[2]) as WarehouseId;
        const d = Number(m[3]);
        const t = Number(m[4]);
        const p = Number(m[5]);
        return { warehouse: (w === 1 || w === 2 || w === 3 ? w : 1), zone, row: d, level: t, pos: p, code: s, capacity: zone === 'A' ? 1 : 1 };
    }
    m = s.match(reHall);
    if (m) {
        const w = Number(m[1]) as WarehouseId;
        const p = Number(m[2]);
        return { warehouse: (w === 1 || w === 2 || w === 3 ? w : 1), zone: 'S', pos: p, code: s, capacity: 1 };
    }
    return null;
}

export function generateSlotsForWarehouse(warehouse: WarehouseId): Slot[] {
    const out: Slot[] = [];
    // Zone A: 7 dãy, 5 tầng, 8 pallets/tầng
    for (let d = 1; d <= 7; d++) {
        for (let t = 1; t <= 5; t++) {
            for (let p = 1; p <= 8; p++) {
                const slot: Omit<Slot, 'code'> = { warehouse, zone: 'A', row: d, level: t, pos: p, capacity: 1 };
                out.push({ ...slot, code: formatCode(slot) });
            }
        }
    }
    // Zone B: 7 dãy (kho 1 chỉ 6), 4 tầng, 1 pallet/tầng
    const bRows = warehouse === 1 ? 6 : 7;
    for (let d = 1; d <= bRows; d++) {
        for (let t = 1; t <= 4; t++) {
            const p = 1;
            const slot: Omit<Slot, 'code'> = { warehouse, zone: 'B', row: d, level: t, pos: p, capacity: 1 };
            out.push({ ...slot, code: formatCode(slot) });
        }
    }
    // Sảnh: 20 pallets
    for (let p = 1; p <= 20; p++) {
        const slot: Omit<Slot, 'code'> = { warehouse, zone: 'S', pos: p, capacity: 1 };
        out.push({ ...slot, code: formatCode(slot) });
    }
    return out;
}

export function generateAllWarehouses(): Slot[] {
    return ([1, 2, 3] as WarehouseId[]).flatMap(w => generateSlotsForWarehouse(w));
}
