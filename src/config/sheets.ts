export const GOOGLE_SHEET_ID = process.env.SHEET_ID || "";

// Configurable Ranges
// Adjust these to match your actual Google Sheet tab names and ranges.

// DATA TABLES
// DATA TABLES
export const LOTS_SHEET_RANGE = "lot!A1:S";       // A=Lot, B=Product, ... S=DeletedReason
export const DELETED_LOTS_SHEET_RANGE = "deletelot!A1:S"; // A=Lot, ... Q=DeletedAt, R=DeletedBy, S=Reason
export const PRODUCTS_SHEET_RANGE = "Products!A1:M"; // A=Code, B=Name, C=Group, D-F=UOM, G-H=Ratio, I=Spec, J=Desc, K=Img
export const LOCATIONS_SHEET_RANGE = "loc_map!A2:C"; // A=Code, B=Type, C=Desc (Referential)
export const PRODUCTS_DISABLED_CODES_RANGE = "Products!P2:P"; // NEW: Disabled product codes

// STATE & MAPPING
export const LOT_POS_SHEET_RANGE = "lot_pos!A1:B"; // A=Lot, B=Pos - MUST start from A1 to include header for correct row calculation
// Alias for compatibility
export const LOT_POSITIONS_SHEET_RANGE = LOT_POS_SHEET_RANGE;

export const WAREHOUSE_SNAPSHOT_SHEET_RANGE = "warehouse_snapshot!A2:F"; // Snapshot data for fast load

// LOGS & TASKS
export const AUDIT_LOG_SHEET_RANGE = "audit_log!A2:G"; // A=TS, B=User, C=Action, D=Path, E=Details
export const TASKS_SHEET_RANGE = "tasks!A2:K";    // Managed Tasks

// USERS & SETTINGS
// Users sheet now has headers. We read from A2 (or A1 if we want to parse headers dynamically).
// Assuming fixed columns for auth: B=Username, C=Password, D=Role...
export const USER_SHEET_ID = process.env.SHEET_ID || ""; // Same sheet for now
export const USER_SHEET_RANGE = "user!A1:Z";     // Read whole user table including header
export const PERMISSIONS_SHEET_RANGE = "phanquyen!A2:D"; // Role-based permissions

export const SETTINGS_SHEET_RANGE = "Settings!A2:C"; // Key-Value settings if needed
