"use client";

import { useState, useCallback, useRef, useMemo, createContext, useEffect, useContext } from "react";
import { Loader2, X, Check, Info, AlertTriangle } from "lucide-react";

type ToastType = "success" | "error" | "info" | "warning";

interface Toast {
    id: number;
    message: string;
    type: ToastType;
}

interface UIContextType {
    startLoading: (msg?: string) => void;
    stopLoading: () => void;
    toast: (msg: string, type?: ToastType, duration?: number) => void;
    confirm: (config: ConfirmConfig) => void;
}

interface ConfirmConfig {
    title?: string;
    message: string;
    type?: ToastType;
    onEnsure?: () => Promise<void> | void;
    onCancel?: () => void;
}

const UIContext = createContext<UIContextType | null>(null);

export const useUI = () => {
    const ctx = useContext(UIContext);
    if (!ctx) throw new Error("useUI must be used within UIProvider");
    return ctx;
};

export default function UIProvider({ children }: { children: React.ReactNode }) {
    // Loading State
    const [isLoading, setIsLoading] = useState(false);
    const [loadingMsg, setLoadingMsg] = useState("Đang xử lý...");

    // Toast State
    const [toasts, setToasts] = useState<Toast[]>([]);
    const toastIdRef = useRef(0);

    // Confirm Modal State
    const [confirmConfig, setConfirmConfig] = useState<ConfirmConfig | null>(null);

    const startLoading = useCallback((msg = "Đang xử lý...") => {
        setLoadingMsg(msg);
        setIsLoading(true);
    }, []);

    const stopLoading = useCallback(() => {
        setIsLoading(false);
    }, []);

    const toast = useCallback((message: string, type: ToastType = "info", duration = 3000) => {
        const id = ++toastIdRef.current;
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, duration);
    }, []);

    const confirm = useCallback((config: ConfirmConfig) => {
        setConfirmConfig(config);
    }, []);

    const closeConfirm = () => setConfirmConfig(null);

    const handleConfirm = async () => {
        if (!confirmConfig) return;
        if (confirmConfig.onEnsure) {
            await confirmConfig.onEnsure();
        }
        closeConfirm();
    };

    const value = useMemo(() => ({
        startLoading,
        stopLoading,
        toast,
        confirm
    }), [startLoading, stopLoading, toast, confirm]);

    return (
        <UIContext.Provider value={value}>
            {children}

            {/* Loading Overlay */}
            {isLoading && (
                <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-zinc-900 rounded-2xl p-6 shadow-2xl flex flex-col items-center gap-3 min-w-[200px]">
                        <Loader2 className="w-10 h-10 text-emerald-600 animate-spin" />
                        <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300 animate-pulse">{loadingMsg}</p>
                    </div>
                </div>
            )}

            {/* Toast Container */}
            <div className="fixed top-4 right-4 z-[110] flex flex-col gap-2 pointer-events-none">
                {toasts.map(t => (
                    <div
                        key={t.id}
                        className={`pointer-events-auto px-4 py-3 rounded-xl shadow-lg flex items-center gap-3 min-w-[300px] animate-in slide-in-from-right-full fade-in duration-300 ${t.type === "success" ? "bg-white border-l-4 border-emerald-500 text-zinc-800" :
                            t.type === "error" ? "bg-white border-l-4 border-rose-500 text-zinc-800" :
                                t.type === "warning" ? "bg-white border-l-4 border-amber-500 text-zinc-800" :
                                    "bg-white border-l-4 border-blue-500 text-zinc-800"
                            }`}
                    >
                        <div className={`p-1 rounded-full ${t.type === "success" ? "bg-emerald-100 text-emerald-600" :
                            t.type === "error" ? "bg-rose-100 text-rose-600" :
                                t.type === "warning" ? "bg-amber-100 text-amber-600" :
                                    "bg-blue-100 text-blue-600"
                            }`}>
                            {t.type === "success" && <Check size={16} strokeWidth={3} />}
                            {t.type === "error" && <X size={16} strokeWidth={3} />}
                            {t.type === "warning" && <AlertTriangle size={16} strokeWidth={3} />}
                            {t.type === "info" && <Info size={16} strokeWidth={3} />}
                        </div>
                        <p className="text-sm font-medium flex-1">{t.message}</p>
                        <button
                            onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
                            className="text-zinc-400 hover:text-zinc-600"
                        >
                            <X size={14} />
                        </button>
                    </div>
                ))}
            </div>

            {/* Confirm Dialog */}
            {confirmConfig && (
                <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-zinc-900 w-full max-w-sm rounded-2xl shadow-xl overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="p-6">
                            <div className="flex items-center gap-3 mb-4">
                                <div className={`p-3 rounded-full ${confirmConfig.type === "error" ? "bg-rose-100 text-rose-600" : "bg-amber-100 text-amber-600"}`}>
                                    <AlertTriangle size={24} />
                                </div>
                                <h3 className="font-bold text-lg text-zinc-900 dark:text-zinc-100">{confirmConfig.title || "Xác nhận"}</h3>
                            </div>
                            <p className="text-zinc-600 dark:text-zinc-300 leading-relaxed">{confirmConfig.message}</p>
                        </div>
                        <div className="p-4 bg-zinc-50 dark:bg-zinc-950/50 flex gap-3 border-t border-zinc-100 dark:border-zinc-800">
                            <button
                                onClick={() => {
                                    if (confirmConfig.onCancel) confirmConfig.onCancel();
                                    closeConfirm();
                                }}
                                className="flex-1 py-2.5 rounded-xl font-medium text-zinc-600 bg-white border border-zinc-200 hover:bg-zinc-50 transition-colors"
                            >
                                Hủy
                            </button>
                            <button
                                onClick={handleConfirm}
                                className={`flex-1 py-2.5 rounded-xl font-bold text-white shadow-lg transition-transform active:scale-95 ${confirmConfig.type === "error" ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-600 hover:bg-emerald-700"}`}
                            >
                                Đồng ý
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </UIContext.Provider>
    );
}
