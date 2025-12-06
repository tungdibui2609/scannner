/**
 * Utility functions for Vietnam timezone (UTC+7)
 */

/**
 * Get current date/time in Vietnam timezone as ISO string
 * @returns ISO string in Vietnam timezone (e.g., "2025-11-19T14:30:00.000+07:00")
 */
export function getVNTimestamp(): string {
    const now = new Date();

    // Convert to Vietnam timezone (UTC+7)
    const vnTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));

    // Get components
    const year = vnTime.getFullYear();
    const month = String(vnTime.getMonth() + 1).padStart(2, '0');
    const day = String(vnTime.getDate()).padStart(2, '0');
    const hours = String(vnTime.getHours()).padStart(2, '0');
    const minutes = String(vnTime.getMinutes()).padStart(2, '0');
    const seconds = String(vnTime.getSeconds()).padStart(2, '0');
    const ms = String(vnTime.getMilliseconds()).padStart(3, '0');

    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${ms}+07:00`;
}

/**
 * Get current date in Vietnam timezone (YYYY-MM-DD format)
 * @returns Date string (e.g., "2025-11-19")
 */
export function getVNDate(): string {
    const vnTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
    const year = vnTime.getFullYear();
    const month = String(vnTime.getMonth() + 1).padStart(2, '0');
    const day = String(vnTime.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Get current time in Vietnam timezone (HH:mm format)
 * @returns Time string (e.g., "14:30")
 */
export function getVNTime(): string {
    const vnTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
    const hours = String(vnTime.getHours()).padStart(2, '0');
    const minutes = String(vnTime.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

/**
 * Convert a Date object to Vietnam timezone ISO string
 * @param date Date object to convert
 * @returns ISO string in Vietnam timezone
 */
export function toVNTimestamp(date: Date): string {
    const vnTime = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));

    const year = vnTime.getFullYear();
    const month = String(vnTime.getMonth() + 1).padStart(2, '0');
    const day = String(vnTime.getDate()).padStart(2, '0');
    const hours = String(vnTime.getHours()).padStart(2, '0');
    const minutes = String(vnTime.getMinutes()).padStart(2, '0');
    const seconds = String(vnTime.getSeconds()).padStart(2, '0');
    const ms = String(vnTime.getMilliseconds()).padStart(3, '0');

    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${ms}+07:00`;
}
