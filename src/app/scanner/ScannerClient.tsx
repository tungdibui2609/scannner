"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import dynamic from "next/dynamic";
import { Trash2, UploadCloud, Wifi, WifiOff, Package, Download, RefreshCw, ArrowLeft, Check, AlertTriangle } from "lucide-react";
import LoginForm from "@/components/LoginForm";
import ScannerDialog, { DialogType } from "@/components/scanner/ScannerDialog";
import { useProducts } from "@/hooks/useProducts";
import { normalizeUnit } from "@/lib/conversionHelper";

const QRScanner = dynamic(() => import("@/components/scanner/QRScanner"), {
    ssr: false,
    loading: () => <div className="h-[300px] w-full bg-zinc-100 dark:bg-zinc-800 rounded-xl flex items-center justify-center animate-pulse"><p className="text-zinc-400 font-medium">Đang tải camera...</p></div>
});

interface ScannedItem {
    id: string;
    timestamp: number;
    position: string;
    synced: boolean;
}

interface ScannerClientProps {
    isAuthenticated: boolean;
}

export default function ScannerClient({ isAuthenticated: initialAuth }: ScannerClientProps) {
    const [isAuthenticated, setIsAuthenticated] = useState(initialAuth);
    const [items, setItems] = useState<ScannedItem[]>([]);
    const [isOnline, setIsOnline] = useState<boolean>(true);
    const [showScanner, setShowScanner] = useState(false);
    const [showDebug, setShowDebug] = useState(false);
    const [lastScanned, setLastScanned] = useState<string | null>(null);

    const [locations, setLocations] = useState<string[]>([]);
    const [occupied, setOccupied] = useState<Record<string, string>>({});
    const [suggestions, setSuggestions] = useState<Array<{ code: string; lotCode?: string }>>([]);
    const [activeInputIndex, setActiveInputIndex] = useState<number | null>(null);
    const [isDownloading, setIsDownloading] = useState(false);
    const [lastUpdated, setLastUpdated] = useState<number | null>(null);

    const [swStatus, setSwStatus] = useState<string>("idle");
    const [swError, setSwError] = useState<string | null>(null);

    // Export State
    const { products } = useProducts();
    const [exportStep, setExportStep] = useState<'scan' | 'form'>('scan');
    const [exportData, setExportData] = useState<{ lotCode: string; lines: any[]; header: any } | null>(null);
    const [exportMode, setExportMode] = useState<"FULL" | "PARTIAL">("FULL");
    const [exportReason, setExportReason] = useState("");
    const [selectedLineIndex, setSelectedLineIndex] = useState<number>(-1);
    const [exportQuantity, setExportQuantity] = useState<string>("");
    const [exportUnit, setExportUnit] = useState<string>("");
    const [isExporting, setIsExporting] = useState(false);

    // Dialog State
    const [dialog, setDialog] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        type: DialogType;
        onConfirm: () => void;
        onCancel?: () => void;
        confirmText?: string;
        cancelText?: string;
    }>({
        isOpen: false,
        title: "",
        message: "",
        type: "info",
        onConfirm: () => { },
    });

    const showDialog = (config: Partial<typeof dialog>) => {
        setDialog({
            isOpen: true,
            title: config.title || "Thông báo",
            message: config.message || "",
            type: config.type || "info",
            onConfirm: config.onConfirm || (() => setDialog(prev => ({ ...prev, isOpen: false }))),
            onCancel: config.onCancel || (() => setDialog(prev => ({ ...prev, isOpen: false }))),
            confirmText: config.confirmText,
            cancelText: config.cancelText,
        });
    };

    const closeDialog = () => {
        setDialog(prev => ({ ...prev, isOpen: false }));
    };

    useEffect(() => {
        // Check client-side persistence for auth
        const persistedAuth = localStorage.getItem("scanner_is_logged_in");
        if (persistedAuth === "true") {
            setIsAuthenticated(true);
        }

        const saved = localStorage.getItem("offline_scanned_items");
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) {
                    setItems(parsed);
                } else {
                    setItems([]);
                }
            } catch (e) {
                console.error("Failed to load saved items, clearing...", e);
                localStorage.removeItem("offline_scanned_items");
                setItems([]);
            }
        }

        const savedLocations = localStorage.getItem("offline_static_locations");
        if (savedLocations) {
            try {
                const parsed = JSON.parse(savedLocations);
                if (Array.isArray(parsed)) {
                    setLocations(parsed);
                } else {
                    setLocations([]);
                }
            } catch (e) {
                localStorage.removeItem("offline_static_locations");
                setLocations([]);
            }
        }

        const savedOccupied = localStorage.getItem("offline_occupied_locations");
        if (savedOccupied) {
            try {
                const parsed = JSON.parse(savedOccupied);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    setOccupied(parsed);
                } else {
                    setOccupied({});
                }
            } catch (e) {
                localStorage.removeItem("offline_occupied_locations");
                setOccupied({});
            }
        }



        const savedLastUpdated = localStorage.getItem("offline_data_last_updated");
        if (savedLastUpdated) {
            setLastUpdated(parseInt(savedLastUpdated, 10));
        }

        const handleOnline = () => {
            setIsOnline(true);
            // Check if we need to fetch static locations (first run)
            if (!localStorage.getItem("offline_static_locations")) {
                fetchStaticLocations();
            }
        };
        const handleOffline = () => setIsOnline(false);
        window.addEventListener("online", handleOnline);
        window.addEventListener("offline", handleOffline);
        setIsOnline(navigator.onLine);

        if (navigator.onLine && !localStorage.getItem("offline_static_locations")) {
            fetchStaticLocations();
        }

        // Register Service Worker (silent mode)
        if ("serviceWorker" in navigator) {
            navigator.serviceWorker.register("/sw.js").catch(() => { });
        }

        return () => {
            window.removeEventListener("online", handleOnline);
            window.removeEventListener("offline", handleOffline);
        };
    }, []);

    const fetchStaticLocations = async () => {
        try {
            const res = await fetch("/api/scanner/locations");
            if (res.ok) {
                const data = await res.json();
                if (data.ok && Array.isArray(data.locations)) {
                    setLocations(data.locations);
                    localStorage.setItem("offline_static_locations", JSON.stringify(data.locations));
                }
            }
        } catch (e) {
            console.error("Failed to fetch static locations", e);
        }
    };

    const fetchOccupiedData = async () => {
        if (!navigator.onLine) {
            showDialog({
                type: "error",
                title: "Lỗi kết nối",
                message: "Không có kết nối mạng! Vui lòng kiểm tra lại đường truyền.",
            });
            return;
        }
        setIsDownloading(true);
        try {
            // Ensure static locations are loaded too
            if (locations.length === 0) {
                await fetchStaticLocations();
            }

            const res = await fetch("/api/scanner/occupied");
            if (res.ok) {
                const data = await res.json();
                if (data.ok) {
                    const safeOccupied = (data.occupied && typeof data.occupied === 'object') ? data.occupied : {};
                    setOccupied(safeOccupied);
                    localStorage.setItem("offline_occupied_locations", JSON.stringify(safeOccupied));

                    // Sync Active Lots to List -> DISABLED as per user request (restore old behavior)
                    // if (Array.isArray(data.activeLots)) {
                    //     const serverItems: ScannedItem[] = data.activeLots.map((l: any) => ({
                    //         id: l.lotCode,
                    //         // Use a slightly older timestamp to ensure they appear as "original" but keep sort order
                    //         timestamp: Date.now() - 1000,
                    //         position: l.position,
                    //         synced: true
                    //     }));

                    //     setItems(prev => {
                    //         // 1. Keep all local UNSYNCED items (User work in progress)
                    //         const localUnsynced = prev.filter(i => !i.synced);
                    //         const localUnsyncedIds = new Set(localUnsynced.map(i => i.id));

                    //         // 2. Filter server items that don't conflict with local unsynced
                    //         const validServerItems = serverItems.filter(i => !localUnsyncedIds.has(i.id));

                    //         // 3. Combine
                    //         return [...localUnsynced, ...validServerItems];
                    //     });
                    // }

                    const now = Date.now();
                    setLastUpdated(now);
                    localStorage.setItem("offline_data_last_updated", now.toString());
                    showDialog({
                        type: "info",
                        title: "Thành công",
                        message: `Đã tải xong dữ liệu hàng hóa!\n(Tìm thấy ${data.activeLots?.length || 0} vị trí đã lưu)`,
                    });
                }
            } else {
                showDialog({ type: "error", title: "Lỗi", message: "Lỗi tải dữ liệu từ server." });
            }
        } catch (e) {
            console.error("Failed to fetch occupied data", e);
            showDialog({ type: "error", title: "Lỗi", message: "Lỗi kết nối server." });
        } finally {
            setIsDownloading(false);
        }
    };

    useEffect(() => {
        localStorage.setItem("offline_scanned_items", JSON.stringify(items));
    }, [items]);

    const isProcessingRef = useRef(false);

    const handleScan = async (decodedText: string) => {
        if (isProcessingRef.current) return;

        try {
            isProcessingRef.current = true;
            let lotId = decodedText;
            if (decodedText.includes("/qr/")) {
                const url = new URL(decodedText);
                const pathParts = url.pathname.split("/");
                const qrIndex = pathParts.indexOf("qr");
                if (qrIndex !== -1 && pathParts[qrIndex + 1]) {
                    lotId = pathParts[qrIndex + 1];
                }
            }
            lotId = lotId.trim();

            // Close scanner immediately
            setShowScanner(false);

            // Scroll to top to show the item
            window.scrollTo({ top: 0, behavior: 'smooth' });

            // 1. Check Offline/Cache first (Fastest & Works Offline)
            // MERGED LOT LOGIC REMOVED

            // 2. Fallback to Online Check if not found in cache
            if (navigator.onLine) {
                try {
                    const res = await fetch(`/api/lots?q=${encodeURIComponent(lotId)}&checkMerge=true`);
                    if (res.ok) {
                        const data = await res.json();
                        const found = data.items?.find((i: any) => i.lotCode === lotId);
                        // Check if mergedTo exists (primary signal) or status is MERGED
                        if (found && (found.mergedTo || found.status === 'MERGED')) {
                            // Logic for online check removed as user requested full removal of this feature
                            // For now we just ignore it / treat as normal scan if it exists physically
                        }
                    }
                } catch (e) {
                    console.error("Failed to check lot status", e);
                }
            }

            setLastScanned(lotId);
            setItems(prev => {
                const existingIndex = prev.findIndex(i => i.id === lotId);
                const newItem: ScannedItem = {
                    id: lotId,
                    timestamp: Date.now(),
                    position: existingIndex !== -1 ? prev[existingIndex].position : "",
                    synced: false // Always unlock for editing
                };

                if (existingIndex !== -1) {
                    // Remove old instance
                    const newItems = [...prev];
                    newItems.splice(existingIndex, 1);
                    // Add updated instance to top
                    return [newItem, ...newItems];
                }

                // Add new item
                return [newItem, ...prev];
            });

            const audio = new Audio('/beep.mp3');
            audio.play().catch(() => { });
        } catch (e) {
            console.error("Error parsing QR", e);
        } finally {
            // Small delay to prevent immediate re-trigger if user opens scanner again quickly
            setTimeout(() => {
                isProcessingRef.current = false;
            }, 1000);
        }
    };

    const updatePosition = (index: number, position: string) => {
        const newItems = [...items];
        newItems[index].position = position;
        setItems(newItems);

        // Filter suggestions
        if (position.trim()) {
            const q = position.toUpperCase();
            const normalize = (str: string) => str.replace(/[.\-]/g, "");
            const qNormalized = normalize(q);

            const matches: Array<{ code: string; lotCode?: string; score: number }> = [];

            for (const code of locations) {
                const codeUpper = code.toUpperCase();
                const codeNormalized = normalize(codeUpper);
                let score = 0;

                // Priority 1: Exact match (normalized)
                if (codeNormalized === qNormalized) {
                    score = 1000;
                }
                // Priority 2: Exact match (original)
                else if (codeUpper === q) {
                    score = 950;
                }
                // Priority 3: Starts with query (normalized)
                else if (codeNormalized.startsWith(qNormalized)) {
                    score = 900;
                }
                // Priority 4: Starts with query (original)
                else if (codeUpper.startsWith(q)) {
                    score = 850;
                }
                // Priority 5: Contains query (normalized)
                else if (codeNormalized.includes(qNormalized)) {
                    score = 700;
                }
                // Priority 6: Contains query (original)
                else if (codeUpper.includes(q)) {
                    score = 650;
                }
                // Priority 7: Partial matches (split by - and .)
                else {
                    const parts = codeUpper.split(/[-.]/).filter(Boolean);
                    if (parts.some((p) => p.startsWith(q))) {
                        score = 500;
                    } else if (parts.some((p) => p.includes(q))) {
                        score = 300;
                    }
                }

                if (score > 0) {
                    matches.push({
                        code: code,
                        lotCode: occupied[code] || undefined,
                        score
                    });
                }
            }

            // Sort by score descending, then by code
            matches.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                return a.code.localeCompare(b.code);
            });

            const filtered = matches.slice(0, 5).map(m => ({ code: m.code, lotCode: m.lotCode }));
            setSuggestions(filtered);
            setActiveInputIndex(index);
        } else {
            setSuggestions([]);
            setActiveInputIndex(null);
        }
    };

    const selectSuggestion = (index: number, position: string) => {
        updatePosition(index, position);
        setSuggestions([]);
        setActiveInputIndex(null);
    };

    const removeItem = (index: number) => {
        const newItems = [...items];
        newItems.splice(index, 1);
        setItems(newItems);
    };

    const clearSyncedItems = () => {
        // No confirmation needed - just clear synced items
        setItems(prev => prev.filter(i => !i.synced));
    };

    const handleSync = async () => {
        if (!isOnline) {
            showDialog({ type: "error", title: "Lỗi", message: "Không có kết nối mạng!" });
            return;
        }
        // Sort by timestamp ascending (Oldest first -> FIFO)
        const pendingItems = items
            .filter(i => !i.synced && i.position.trim())
            .sort((a, b) => a.timestamp - b.timestamp);
        if (pendingItems.length === 0) {
            showDialog({ type: "info", title: "Thông báo", message: "Không có dữ liệu cần đồng bộ. Hãy đảm bảo đã nhập vị trí cho các LOT." });
            return;
        }

        // Client-side pre-check (Soft warning only)
        const potentialConflicts = pendingItems.filter(item => {
            const pos = item.position.trim();
            const conflictLot = occupied[pos] || occupied[pos.toUpperCase()];
            return conflictLot && conflictLot !== item.id;
        });

        if (potentialConflicts.length > 0) {
            showDialog({
                type: "warning",
                title: "Cảnh báo trùng lặp",
                message: `Có ${potentialConflicts.length} mục có thể bị trùng vị trí dựa trên dữ liệu cũ.\nBạn có muốn tiếp tục gửi lên Server để kiểm tra chính xác không?`,
                onConfirm: () => {
                    // Proceed with sync
                    performSync(pendingItems);
                    closeDialog();
                },
                onCancel: closeDialog
            });
            return;
        }

        performSync(pendingItems);
    };

    const performSync = async (pendingItems: ScannedItem[]) => {
        try {
            const response = await fetch("/api/scanner/sync", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ items: pendingItems }),
            });
            const data = await response.json();

            if (response.ok && data.success) {
                // Mark successful items as synced
                const syncedIds = new Set(data.results.filter((r: any) => r.success).map((r: any) => r.lotCode));
                setItems(prev => prev.map(item => syncedIds.has(item.id) ? { ...item, synced: true } : item));

                // Handle conflicts/errors
                const conflicts = data.results.filter((r: any) => r.conflict);
                const otherErrors = data.results.filter((r: any) => !r.success && !r.conflict);

                let msg = `Đã đồng bộ thành công ${data.successCount} mục!`;

                if (conflicts.length > 0) {
                    const conflictDetails = conflicts.map((c: any) => `- LOT ${c.lotCode}: ${c.error}`).join("\n");
                    msg += `\n\n⚠️ CÓ ${conflicts.length} MỤC BỊ TRÙNG VỊ TRÍ (Server từ chối):\n${conflictDetails}`;
                }

                if (otherErrors.length > 0) {
                    msg += `\n\n❌ Có ${otherErrors.length} mục bị lỗi khác.`;
                }

                showDialog({ type: "info", title: "Kết quả đồng bộ", message: msg });

                // Refresh occupied data if there were successful updates
                if (data.successCount > 0) {
                    fetchOccupiedData();
                }
            } else {
                showDialog({ type: "error", title: "Lỗi", message: "Lỗi khi đồng bộ dữ liệu: " + (data.error || "Unknown error") });
            }
        } catch (e) {
            console.error("Sync error", e);
            showDialog({ type: "error", title: "Lỗi", message: "Lỗi kết nối server." });
        }
    };

    // --- Export Logic ---

    const handleExportScan = async (decodedText: string) => {
        if (isProcessingRef.current) return;
        try {
            isProcessingRef.current = true;
            let lotId = decodedText;
            if (decodedText.includes("/qr/")) {
                const url = new URL(decodedText);
                const pathParts = url.pathname.split("/");
                const qrIndex = pathParts.indexOf("qr");
                if (qrIndex !== -1 && pathParts[qrIndex + 1]) {
                    lotId = pathParts[qrIndex + 1];
                }
            }

            setShowScanner(false);
            setIsExporting(true);

            // Fetch lot details
            const res = await fetch(`/api/lots/${encodeURIComponent(lotId)}/lines`);
            const js = await res.json();

            if (!res.ok) {
                showDialog({ type: "error", title: "Lỗi", message: js?.error || "Không tìm thấy thông tin LOT" });
                setIsExporting(false);
                return;
            }

            setExportData({
                lotCode: lotId,
                lines: Array.isArray(js?.items) ? js.items : [],
                header: js?.header
            });
            setExportStep('form');
            setExportMode('FULL');
            setExportReason("");
            setSelectedLineIndex(-1);
            setExportQuantity("");
            setExportUnit("");

        } catch (e) {
            console.error("Export scan error", e);
            showDialog({ type: "error", title: "Lỗi", message: "Lỗi khi tải thông tin LOT" });
        } finally {
            setIsExporting(false);
            setTimeout(() => { isProcessingRef.current = false; }, 1000);
        }
    };

    // Conversion Logic for Partial Export
    const selectedLine = exportData && selectedLineIndex >= 0 && exportData.lines.length > 0 ? exportData.lines[selectedLineIndex] : null;
    const maxQuantity = selectedLine ? Number(selectedLine.quantity || 0) : 0;
    const currentUnit = selectedLine?.unit || "";

    const product = useMemo(() => {
        if (!selectedLine) return null;
        return products.find(p => p.code === selectedLine.productCode);
    }, [selectedLine, products]);

    const availableUnits = useMemo(() => {
        if (!product) return currentUnit ? [currentUnit] : [];
        const units = [product.uomSmall, product.uomMedium, product.uomLarge].filter(Boolean) as string[];
        return [...new Set(units)];
    }, [product, currentUnit]);

    useEffect(() => {
        if (selectedLine && !exportUnit) {
            setExportUnit(selectedLine.unit || "");
        }
    }, [selectedLine, exportUnit]);

    const exportQty = Number(exportQuantity) || 0;

    const conversionResult = useMemo(() => {
        if (exportMode !== "PARTIAL" || !selectedLine || !product || !exportUnit || exportQty <= 0) return null;

        if (normalizeUnit(exportUnit) === normalizeUnit(currentUnit)) {
            return {
                isDifferentUnit: false,
                consumed: exportQty,
                remainder: 0,
                isValid: exportQty <= maxQuantity
            };
        }

        const getRatioToSmall = (unit: string) => {
            const nUnit = normalizeUnit(unit);
            if (nUnit === normalizeUnit(product.uomSmall || "")) return 1;
            const ratioSmallToMedium = parseFloat(product.ratioSmallToMedium || "0") || 0;
            if (nUnit === normalizeUnit(product.uomMedium || "")) return ratioSmallToMedium;
            const ratioMediumToLarge = parseFloat(product.ratioMediumToLarge || "0") || 0;
            if (nUnit === normalizeUnit(product.uomLarge || "")) return ratioMediumToLarge * ratioSmallToMedium;
            return 0;
        };

        const currentRatio = getRatioToSmall(currentUnit);
        const targetRatio = getRatioToSmall(exportUnit);

        if (currentRatio === 0 || targetRatio === 0) return null;

        const splitInSmall = exportQty * targetRatio;
        const consumedCurrent = Math.ceil(splitInSmall / currentRatio);
        const consumedInSmall = consumedCurrent * currentRatio;
        const remainderInSmall = consumedInSmall - splitInSmall;
        const remainderInTarget = remainderInSmall / targetRatio;

        return {
            isDifferentUnit: true,
            consumed: consumedCurrent,
            remainder: remainderInTarget,
            isValid: consumedCurrent <= maxQuantity
        };
    }, [exportMode, selectedLine, product, exportUnit, exportQty, currentUnit, maxQuantity]);

    const isExportValid = useMemo(() => {
        if (!exportReason.trim()) return false;
        if (exportMode === "FULL") return true;
        if (exportMode === "PARTIAL") {
            if (selectedLineIndex < 0) return false;
            return conversionResult?.isValid ?? (exportQty > 0 && exportQty <= maxQuantity);
        }
        return false;
    }, [exportReason, exportMode, selectedLineIndex, conversionResult, exportQty, maxQuantity]);

    const handleExportSubmit = async () => {
        if (!isExportValid || isExporting || !exportData) return;
        try {
            setIsExporting(true);
            const deletedBy = localStorage.getItem("userName") || localStorage.getItem("userUsername") || "";

            const payload: any = {
                lotCode: exportData.lotCode,
                deletedBy,
                mode: exportMode,
                reason: exportReason.trim()
            };

            if (exportMode === "PARTIAL") {
                payload.items = [{
                    lineIndex: selectedLineIndex,
                    quantity: exportQty,
                    unit: exportUnit
                }];
            }

            const res = await fetch("/api/lots/export", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            const resData = await res.json();
            if (!res.ok) throw new Error(resData?.error || "EXPORT_FAILED");

            showDialog({
                type: "info",
                title: "Thành công",
                message: resData?.message || `Đã xuất LOT ${exportData.lotCode} thành công`,
                onConfirm: () => {
                    setExportStep('scan');
                    setExportData(null);
                    setShowScanner(true); // Auto-open scanner for next scan
                    closeDialog();
                }
            });

        } catch (e: any) {
            console.error("Export submit error", e);
            showDialog({ type: "error", title: "Lỗi", message: e?.message || "Lỗi khi xuất kho" });
        } finally {
            setIsExporting(false);
        }
    };

    // --- End Export Logic ---

    const [currentView, setCurrentView] = useState<'assign' | 'export' | 'inventory' | 'settings'>('assign');

    if (!isAuthenticated) {
        return <LoginForm onSuccess={() => {
            setIsAuthenticated(true);
            localStorage.setItem("scanner_is_logged_in", "true");
        }} />;
    }

    const renderHeader = (title: string, showDownload: boolean = true) => (
        <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 sticky top-0 z-10 shadow-sm">
            <div className="px-4 py-3 flex items-center justify-between">
                <h1 className="font-bold text-lg text-zinc-900 dark:text-zinc-100">{title}</h1>
                <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${isOnline ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'}`}>
                    {isOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
                    {isOnline ? "Online" : "Offline"}
                </div>
            </div>

            {showDownload && (
                <div className="px-4 pb-3">
                    <button
                        onClick={fetchOccupiedData}
                        disabled={isDownloading || !isOnline}
                        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border transition-all ${isDownloading ? 'bg-zinc-50 border-zinc-200 text-zinc-400' : 'bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/20 active:scale-[0.99]'}`}
                    >
                        <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-full ${isDownloading ? 'bg-zinc-100' : 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'}`}>
                                {isDownloading ? (
                                    <div className="w-4 h-4 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
                                ) : (
                                    <Download size={18} />
                                )}
                            </div>
                            <div className="flex flex-col items-start">
                                <span className="text-sm font-bold">Cập nhật dữ liệu</span>
                                <span className="text-[10px] opacity-70 font-medium">
                                    {lastUpdated ? `Cập nhật: ${new Date(lastUpdated).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}` : 'Chưa có dữ liệu'}
                                </span>
                            </div>
                        </div>
                        <div className="text-xs font-medium px-2 py-1 bg-white dark:bg-zinc-800 rounded-md shadow-sm border border-blue-100 dark:border-blue-900/30">
                            {(!occupied || Object.keys(occupied).length === 0) ? "Tải ngay" : "Làm mới"}
                        </div>
                    </button>
                </div>
            )}
        </div>
    );

    const renderAssign = () => (
        <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 pb-24" onClick={() => { setSuggestions([]); setActiveInputIndex(null); }}>
            {renderHeader("Gán Vị Trí")}

            {!isOnline && (
                <div className="bg-zinc-100 dark:bg-zinc-800 px-4 py-2 text-xs text-zinc-500 dark:text-zinc-400 text-center border-b border-zinc-200 dark:border-zinc-700">
                    Đang làm việc Offline. Dữ liệu có thể không mới nhất.
                </div>
            )}

            <div className="p-4 max-w-md mx-auto">
                {showScanner ? (
                    <div className="mb-6">
                        <div className="flex justify-between items-center mb-2">
                            <h2 className="font-bold text-sm text-zinc-700 dark:text-zinc-300">Camera</h2>
                            <button onClick={() => setShowScanner(false)} className="text-xs text-zinc-500 underline">Đóng</button>
                        </div>
                        <QRScanner onScan={handleScan} />
                    </div>
                ) : (
                    <button onClick={() => setShowScanner(true)} className="w-full py-4 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-xl font-bold shadow-lg shadow-zinc-500/20 active:scale-95 transition-transform flex items-center justify-center gap-2 mb-6">
                        <Package size={20} />
                        Quét Mã Mới
                    </button>
                )}
                <div className="space-y-4">
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                            <h2 className="font-bold text-zinc-900 dark:text-zinc-100">Danh sách ({items.length})</h2>
                            <div className="flex gap-2">
                                {/* Quét tiếp button - always show when scanner is closed */}
                                {!showScanner && (
                                    <button
                                        onClick={() => setShowScanner(true)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg text-sm font-medium hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors"
                                        title="Quét mã tiếp"
                                    >
                                        <Package size={16} />
                                        Quét tiếp
                                    </button>
                                )}
                                {items.some(i => i.synced) && (
                                    <button
                                        onClick={clearSyncedItems}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded-lg text-sm font-medium hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                                        title="Xóa các mục đã xong"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                )}
                                {items.length > 0 && (
                                    <button onClick={handleSync} disabled={!isOnline} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-emerald-700 transition-colors">
                                        <UploadCloud size={16} />
                                        Đồng bộ
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                    {items.length === 0 ? (
                        <div className="text-center py-10 text-zinc-400 text-sm italic">Chưa có dữ liệu. Hãy quét mã LOT để bắt đầu.</div>
                    ) : (
                        <div className="space-y-3">
                            {items.map((item, index) => (
                                <div key={item.timestamp} className={`p-3 rounded-xl border shadow-sm flex gap-3 ${item.synced ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800' : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800'}`}>
                                    <div className="flex-1 min-w-0 relative">
                                        <div className="flex items-center gap-2">
                                            <div className="font-bold text-zinc-800 dark:text-zinc-200 truncate">{item.id}</div>
                                            {item.synced && (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold rounded-full">
                                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                                                    Đã đồng bộ
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-[10px] text-zinc-400 mb-2">{new Date(item.timestamp).toLocaleTimeString()}</div>
                                        <div className="relative">
                                            <input
                                                type="text"
                                                placeholder="Nhập vị trí kệ..."
                                                value={item.position}
                                                onChange={(e) => updatePosition(index, e.target.value)}
                                                onFocus={() => {
                                                    if (item.position) updatePosition(index, item.position);
                                                }}
                                                disabled={item.synced}
                                                className={`w-full px-2 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/50 ${item.synced ? 'bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-500 cursor-not-allowed' : 'bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700'}`}
                                                onClick={(e) => e.stopPropagation()}
                                            />
                                            {activeInputIndex === index && suggestions.length > 0 && (
                                                <div className="absolute z-50 left-0 right-0 mt-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                                                    {suggestions.map((s) => (
                                                        <div
                                                            key={s.code}
                                                            className="px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer flex justify-between items-center"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                selectSuggestion(index, s.code);
                                                            }}
                                                        >
                                                            <span className="text-zinc-800 dark:text-zinc-200 font-medium">{s.code}</span>
                                                            {s.lotCode ? (
                                                                <span className="text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded">Có LOT: {s.lotCode}</span>
                                                            ) : (
                                                                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-1.5 py-0.5 rounded">Trống</span>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    {!item.synced && (
                                        <button onClick={() => removeItem(index)} className="p-2 text-zinc-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg self-start transition-colors">
                                            <Trash2 size={18} />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );

    const renderExport = () => (
        <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 pb-24">
            {renderHeader("Xuất Kho", false)}

            <div className="p-4 max-w-md mx-auto">
                {exportStep === 'scan' ? (
                    <>
                        {showScanner ? (
                            <div className="mb-6">
                                <div className="flex justify-between items-center mb-2">
                                    <h2 className="font-bold text-sm text-zinc-700 dark:text-zinc-300">Camera</h2>
                                    <button onClick={() => setShowScanner(false)} className="text-xs text-zinc-500 underline">Đóng</button>
                                </div>
                                <QRScanner onScan={handleExportScan} />
                            </div>
                        ) : (
                            <button onClick={() => setShowScanner(true)} className="w-full py-8 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-2xl font-bold shadow-lg shadow-zinc-500/20 active:scale-95 transition-transform flex flex-col items-center justify-center gap-3 mb-6">
                                <div className="p-4 bg-white/10 dark:bg-black/10 rounded-full">
                                    <Package size={32} />
                                </div>
                                <span>Quét Mã LOT để Xuất</span>
                            </button>
                        )}
                        <div className="text-center text-zinc-400 text-sm">
                            Hoặc nhập mã thủ công (Tính năng sắp có)
                        </div>
                    </>
                ) : (
                    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
                        <div className="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <div className="text-xs text-zinc-500">Mã LOT</div>
                                    <div className="font-bold text-lg text-rose-600 dark:text-rose-400">{exportData?.lotCode}</div>
                                </div>
                                <button
                                    onClick={() => { setExportStep('scan'); setExportData(null); setShowScanner(true); }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg text-sm font-medium hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors"
                                >
                                    <Package size={14} />
                                    Quét LOT khác
                                </button>
                            </div>

                            {/* Mode Selection */}
                            <div className="flex gap-2 p-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg mb-4">
                                <button
                                    onClick={() => setExportMode("FULL")}
                                    className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all ${exportMode === "FULL"
                                        ? "bg-white dark:bg-zinc-700 text-rose-600 dark:text-rose-400 shadow-sm"
                                        : "text-zinc-500"
                                        }`}
                                >
                                    Xuất Hết
                                </button>
                                <button
                                    onClick={() => setExportMode("PARTIAL")}
                                    className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all ${exportMode === "PARTIAL"
                                        ? "bg-white dark:bg-zinc-700 text-rose-600 dark:text-rose-400 shadow-sm"
                                        : "text-zinc-500"
                                        }`}
                                >
                                    Xuất Lẻ
                                </button>
                            </div>

                            {/* Partial Mode Inputs */}
                            {exportMode === "PARTIAL" && exportData && (
                                <div className="space-y-3 mb-4">
                                    <div>
                                        <label className="block text-xs font-medium text-zinc-500 mb-1.5">Chọn sản phẩm</label>
                                        <div className="space-y-2 max-h-40 overflow-y-auto border border-zinc-200 dark:border-zinc-700 rounded-lg p-1">
                                            {exportData.lines.map((line, idx) => (
                                                <button
                                                    key={idx}
                                                    onClick={() => {
                                                        setSelectedLineIndex(idx);
                                                        setExportQuantity("");
                                                        setExportUnit(line.unit || "");
                                                    }}
                                                    className={`w-full text-left p-2 rounded-md border transition-all ${selectedLineIndex === idx
                                                        ? "border-rose-500 bg-rose-50 dark:bg-rose-900/20 dark:border-rose-600"
                                                        : "border-transparent hover:bg-zinc-50 dark:hover:bg-zinc-800"
                                                        }`}
                                                >
                                                    <div className="flex justify-between items-center">
                                                        <span className="text-sm font-medium truncate flex-1">{line.productCode}</span>
                                                        <span className="text-xs font-bold">{line.quantity} {line.unit}</span>
                                                    </div>
                                                    <div className="text-xs text-zinc-400 truncate">{line.productName}</div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {selectedLine && (
                                        <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <label className="block text-xs font-medium mb-1">Số lượng</label>
                                                    <input
                                                        type="number"
                                                        inputMode="decimal"
                                                        value={exportQuantity}
                                                        onChange={(e) => setExportQuantity(e.target.value)}
                                                        className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
                                                        placeholder="0"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium mb-1">Đơn vị</label>
                                                    <select
                                                        value={exportUnit}
                                                        onChange={(e) => setExportUnit(e.target.value)}
                                                        className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
                                                    >
                                                        {availableUnits.map(u => (
                                                            <option key={u} value={u}>{u}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </div>

                                            {/* Conversion Preview */}
                                            {conversionResult && (
                                                <div className="mt-3 text-xs border-t border-zinc-200 dark:border-zinc-700 pt-2">
                                                    {conversionResult.isDifferentUnit ? (
                                                        <div className="space-y-1">
                                                            <div className="flex justify-between">
                                                                <span className="text-zinc-500">Trừ kho:</span>
                                                                <span className="font-bold">{conversionResult.consumed} {selectedLine.unit}</span>
                                                            </div>
                                                            <div className="flex justify-between">
                                                                <span className="text-zinc-500">Còn lại:</span>
                                                                <span className="font-bold">{(maxQuantity - conversionResult.consumed).toFixed(2)} {selectedLine.unit}</span>
                                                            </div>
                                                            {conversionResult.remainder > 0 && (
                                                                <div className="flex justify-between text-emerald-600">
                                                                    <span>+ Dư:</span>
                                                                    <span className="font-bold">{Number(conversionResult.remainder.toFixed(2))} {exportUnit}</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <div className="flex justify-between">
                                                            <span className="text-zinc-500">Còn lại:</span>
                                                            <span className="font-bold">{(maxQuantity - exportQty).toFixed(2)} {selectedLine.unit}</span>
                                                        </div>
                                                    )}

                                                    {(!conversionResult.isValid) && (
                                                        <div className="mt-2 text-rose-600 font-medium flex items-center gap-1">
                                                            <AlertTriangle size={12} />
                                                            Quá số lượng tồn kho!
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Reason Input */}
                            <div>
                                <label className="block text-xs font-medium text-zinc-500 mb-1.5">Lý do xuất <span className="text-rose-500">*</span></label>
                                <textarea
                                    value={exportReason}
                                    onChange={(e) => setExportReason(e.target.value)}
                                    placeholder="Nhập lý do (VD: Xuất bán, Hư hỏng...)"
                                    className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm min-h-[80px]"
                                />
                            </div>

                            <button
                                onClick={handleExportSubmit}
                                disabled={!isExportValid || isExporting}
                                className="w-full mt-4 py-3 bg-rose-600 text-white rounded-xl font-bold shadow-lg shadow-rose-500/20 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {isExporting ? (
                                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                ) : (
                                    <>
                                        <UploadCloud size={20} />
                                        Xác nhận Xuất
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );

    const renderInventory = () => (
        <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 pb-24">
            {renderHeader("Kiểm Kê")}
            <div className="p-8 flex flex-col items-center justify-center text-center text-zinc-400">
                <div className="w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mb-4">
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                </div>
                <h3 className="text-lg font-bold text-zinc-700 dark:text-zinc-300 mb-2">Tính năng đang phát triển</h3>
                <p className="text-sm">Chức năng kiểm kê sẽ sớm được cập nhật trong phiên bản tiếp theo.</p>
            </div>
        </div>
    );

    const renderBottomNav = () => (
        <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 pb-safe pt-2 px-2 flex justify-around items-center z-50">
            <button
                onClick={() => setCurrentView('assign')}
                className={`flex flex-col items-center p-2 rounded-lg transition-colors ${currentView === 'assign' ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300'}`}
            >
                <Package size={24} />
                <span className="text-[10px] font-medium mt-1">Gán Vị Trí</span>
            </button>
            <button
                onClick={() => setCurrentView('export')}
                className={`flex flex-col items-center p-2 rounded-lg transition-colors ${currentView === 'export' ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300'}`}
            >
                <UploadCloud size={24} />
                <span className="text-[10px] font-medium mt-1">Xuất Kho</span>
            </button>
            <button
                onClick={() => setCurrentView('inventory')}
                className={`flex flex-col items-center p-2 rounded-lg transition-colors ${currentView === 'inventory' ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300'}`}
            >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
                <span className="text-[10px] font-medium mt-1">Kiểm Kê</span>
            </button>
            <button
                onClick={() => setCurrentView('settings')}
                className={`flex flex-col items-center p-2 rounded-lg transition-colors ${currentView === 'settings' ? 'text-zinc-800 dark:text-zinc-200' : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300'}`}
            >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" /></svg>
                <span className="text-[10px] font-medium mt-1">Menu</span>
            </button>
        </div>
    );

    const renderSettings = () => (
        <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 pb-24">
            {renderHeader("Cài Đặt & Dữ Liệu", false)}

            <div className="p-4 space-y-4">
                <div className="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Dữ liệu hệ thống</span>
                        {lastUpdated && (
                            <span className="text-[10px] text-zinc-400">Cập nhật: {new Date(lastUpdated).toLocaleString()}</span>
                        )}
                    </div>
                    <button
                        onClick={fetchOccupiedData}
                        disabled={isDownloading || !isOnline}
                        className={`w-full py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors ${!occupied || Object.keys(occupied).length === 0 ? 'bg-amber-100 text-amber-700 animate-pulse' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'}`}
                    >
                        {isDownloading ? (
                            <div className="w-4 h-4 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin" />
                        ) : (
                            <Download size={18} />
                        )}
                        {(!occupied || Object.keys(occupied).length === 0) ? "Tải dữ liệu ngay" : "Cập nhật dữ liệu"}
                    </button>
                    {isOnline && (!occupied || Object.keys(occupied).length === 0) && (
                        <div className="mt-2 text-xs text-amber-600 text-center">
                            ⚠️ Cần tải dữ liệu để sử dụng các tính năng.
                        </div>
                    )}

                    <button
                        onClick={() => setShowDebug(true)}
                        className="w-full mt-3 py-2 bg-white dark:bg-zinc-800 text-zinc-500 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs font-medium flex items-center justify-center gap-2 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                        🔍 Xem dữ liệu thô (Debug)
                    </button>
                </div>

                <div className="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-3">
                    <h3 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">Thông tin ứng dụng</h3>
                    <div className="flex justify-between text-sm">
                        <span className="text-zinc-500">Phiên bản</span>
                        <span className="font-mono">v1.3</span>
                    </div>
                    <div className="flex justify-between text-sm">
                        <span className="text-zinc-500">Trạng thái SW</span>
                        <span className="font-mono text-xs">{swStatus}</span>
                    </div>
                </div>

                <button
                    onClick={() => {
                        showDialog({
                            type: "confirm",
                            title: "Cập nhật ứng dụng",
                            message: "Bạn có chắc muốn cập nhật ứng dụng? Trang sẽ tải lại để áp dụng thay đổi.",
                            onConfirm: () => {
                                if ('serviceWorker' in navigator) {
                                    navigator.serviceWorker.getRegistrations().then(function (registrations) {
                                        for (let registration of registrations) {
                                            registration.unregister();
                                        }
                                    });
                                }
                                window.location.reload();
                            },
                            onCancel: closeDialog
                        });
                    }}
                    className="w-full py-3 bg-blue-50 text-blue-600 rounded-xl font-medium border border-blue-100 mt-4"
                >
                    <div className="flex items-center justify-center gap-2">
                        <RefreshCw size={18} />
                        Cập nhật ứng dụng (Fix lỗi)
                    </div>
                </button>

                <button
                    onClick={() => {
                        localStorage.removeItem("scanner_is_logged_in");
                        setIsAuthenticated(false);
                    }}
                    className="w-full py-3 bg-rose-50 text-rose-600 rounded-xl font-medium border border-rose-100 mt-4"
                >
                    Đăng xuất
                </button>
            </div>

            <div className="text-[10px] text-zinc-300 text-center py-4 mt-auto">
                Scanner App V.1.5.1 - Created by Anywarehouse
            </div>
        </div>
    );

    const renderDebug = () => (
        <div className="fixed inset-0 z-50 bg-white dark:bg-zinc-950 flex flex-col">
            <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-4 py-3 flex items-center justify-between shadow-sm flex-shrink-0">
                <h1 className="font-bold text-lg">Dữ liệu thô (Debug)</h1>
                <button
                    onClick={() => setShowDebug(false)}
                    className="px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-lg text-sm font-medium"
                >
                    Đóng
                </button>
            </div>

            <div className="flex-1 overflow-auto p-4 space-y-6">
                <div className="space-y-2">
                    <h3 className="font-bold text-sm text-zinc-500 uppercase tracking-wider">Thống kê chung</h3>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 bg-zinc-50 dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800">
                            <div className="text-xs text-zinc-500">Vị trí tĩnh (Locations)</div>
                            <div className="text-xl font-bold">{locations.length}</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    if (showDebug) return renderDebug();

    return (
        <>
            {currentView === 'assign' && renderAssign()}
            {currentView === 'export' && renderExport()}
            {currentView === 'inventory' && renderInventory()}
            {currentView === 'settings' && renderSettings()}
            {renderBottomNav()}

            <ScannerDialog
                isOpen={dialog.isOpen}
                title={dialog.title}
                message={dialog.message}
                type={dialog.type}
                onConfirm={dialog.onConfirm}
                onCancel={dialog.onCancel}
                confirmText={dialog.confirmText}
                cancelText={dialog.cancelText}
            />
        </>
    );
}
