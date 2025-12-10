"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw, Trash2 } from "lucide-react";

export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error("Scanner Runtime Error:", error);
    }, [error]);

    const handleHardReset = () => {
        if (confirm("Thao tác này sẽ xóa toàn bộ dữ liệu đã lưu trên máy để sửa lỗi. Bạn có chắc chắn không?")) {
            localStorage.clear();
            // Clear service workers as well
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.getRegistrations().then(function (registrations) {
                    for (let registration of registrations) {
                        registration.unregister();
                    }
                });
            }
            window.location.reload();
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
            <div className="max-w-md w-full bg-white dark:bg-zinc-900 rounded-2xl shadow-xl p-6 border border-zinc-200 dark:border-zinc-800 text-center">
                <div className="w-16 h-16 bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 rounded-full flex items-center justify-center mx-auto mb-4">
                    <AlertTriangle size={32} />
                </div>
                <h2 className="text-xl font-bold mb-2">Đã xảy ra lỗi!</h2>
                <p className="text-zinc-500 dark:text-zinc-400 mb-6 text-sm break-words">
                    {error.message || "Không thể tải ứng dụng."}
                </p>

                <div className="flex flex-col gap-3">
                    <button
                        onClick={reset}
                        className="w-full flex items-center justify-center gap-2 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold transition-colors"
                    >
                        <RefreshCw size={20} />
                        Thử lại
                    </button>

                    <button
                        onClick={handleHardReset}
                        className="w-full flex items-center justify-center gap-2 py-3 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-xl font-bold transition-colors"
                    >
                        <Trash2 size={20} />
                        Xóa dữ liệu & Tải lại
                    </button>
                    <p className="text-xs text-zinc-400 mt-2">
                        Chọn "Xóa dữ liệu" nếu lỗi vẫn lặp lại sau khi thử lại.
                    </p>
                </div>
            </div>
        </div>
    );
}
