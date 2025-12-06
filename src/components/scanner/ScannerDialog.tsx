"use client";

import { AlertTriangle, CheckCircle, Info, X } from "lucide-react";

export type DialogType = "info" | "confirm" | "error" | "warning";

interface ScannerDialogProps {
    isOpen: boolean;
    title: string;
    message: string;
    type: DialogType;
    onConfirm: () => void;
    onCancel?: () => void;
    confirmText?: string;
    cancelText?: string;
}

export default function ScannerDialog({
    isOpen,
    title,
    message,
    type,
    onConfirm,
    onCancel,
    confirmText = "Đồng ý",
    cancelText = "Hủy",
}: ScannerDialogProps) {
    if (!isOpen) return null;

    const getIcon = () => {
        switch (type) {
            case "error":
                return <AlertTriangle className="text-rose-500" size={32} />;
            case "warning":
                return <AlertTriangle className="text-amber-500" size={32} />;
            case "confirm":
                return <Info className="text-blue-500" size={32} />;
            case "info":
            default:
                return <CheckCircle className="text-emerald-500" size={32} />;
        }
    };

    const getHeaderColor = () => {
        switch (type) {
            case "error":
                return "bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300";
            case "warning":
                return "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300";
            case "confirm":
                return "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300";
            case "info":
            default:
                return "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300";
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-zinc-900 w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className={`px-6 py-4 flex items-center gap-3 ${getHeaderColor()}`}>
                    {getIcon()}
                    <h3 className="font-bold text-lg">{title}</h3>
                </div>

                {/* Body */}
                <div className="p-6">
                    <p className="text-zinc-600 dark:text-zinc-300 whitespace-pre-line text-base leading-relaxed">
                        {message}
                    </p>
                </div>

                {/* Footer */}
                <div className="p-4 bg-zinc-50 dark:bg-zinc-950/50 flex gap-3">
                    {(type === "confirm" || type === "warning" || onCancel) && (
                        <button
                            onClick={onCancel}
                            className="flex-1 py-3 px-4 rounded-xl font-medium text-zinc-600 dark:text-zinc-400 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
                        >
                            {cancelText}
                        </button>
                    )}
                    <button
                        onClick={onConfirm}
                        className={`flex-1 py-3 px-4 rounded-xl font-bold text-white shadow-lg transition-transform active:scale-95 ${type === "error"
                            ? "bg-rose-600 hover:bg-rose-700 shadow-rose-500/20"
                            : type === "warning"
                                ? "bg-amber-600 hover:bg-amber-700 shadow-amber-500/20"
                                : type === "confirm"
                                    ? "bg-blue-600 hover:bg-blue-700 shadow-blue-500/20"
                                    : "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/20"
                            }`}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
}
