"use client";

import { useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { Camera, Image as ImageIcon, StopCircle, AlertCircle } from "lucide-react";

interface QRScannerProps {
    onScan: (decodedText: string) => void;
    onError?: (error: any) => void;
}

export default function QRScanner({ onScan, onError }: QRScannerProps) {
    const [isScanning, setIsScanning] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const scannerRef = useRef<Html5Qrcode | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        // Cleanup on unmount
        return () => {
            if (scannerRef.current) {
                try {
                    // Attempt to stop, suppress errors if element already gone
                    if (isScanning) {
                        scannerRef.current.stop().catch((err) => {
                            console.warn("Scanner stop warning:", err);
                        });
                    }
                    scannerRef.current.clear();
                } catch (e) {
                    console.warn("Scanner cleanup error:", e);
                }
            }
        };
    }, [isScanning]);

    const startScan = async () => {
        setError(null);
        try {
            if (!scannerRef.current) {
                scannerRef.current = new Html5Qrcode("reader");
            }

            await scannerRef.current.start(
                { facingMode: "environment" },
                {
                    fps: 10,
                    qrbox: { width: 250, height: 250 },
                    aspectRatio: 1.0,
                },
                (decodedText) => {
                    onScan(decodedText);
                    stopScan(); // Auto stop after success
                },
                (errorMessage) => {
                    // Ignore frame parse errors
                }
            );
            setIsScanning(true);
        } catch (err: any) {
            console.error("Error starting scanner", err);
            let msg = "Không thể khởi động camera.";
            if (err?.name === "NotAllowedError" || err?.message?.includes("Permission denied")) {
                msg = "Vui lòng cấp quyền truy cập camera trong cài đặt trình duyệt.";
            } else if (err?.name === "NotFoundError") {
                msg = "Không tìm thấy camera trên thiết bị này.";
            } else if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") {
                msg = "Camera yêu cầu kết nối HTTPS an toàn.";
            }
            setError(msg);
        }
    };

    const stopScan = async () => {
        if (scannerRef.current && isScanning) {
            try {
                await scannerRef.current.stop();
                setIsScanning(false);
            } catch (err) {
                console.error("Error stopping scanner", err);
            }
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setError(null);
        try {
            if (!scannerRef.current) {
                scannerRef.current = new Html5Qrcode("reader");
            }
            const result = await scannerRef.current.scanFile(file, true);
            onScan(result);
        } catch (err) {
            console.error("Error scanning file", err);
            setError("Không tìm thấy mã QR trong ảnh này.");
        } finally {
            // Reset input so same file can be selected again
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    return (
        <div className="w-full max-w-md mx-auto">
            {/* Scanner Area */}
            <div className="relative overflow-hidden rounded-xl border-2 border-zinc-200 dark:border-zinc-800 bg-black min-h-[300px] flex flex-col items-center justify-center">
                <div id="reader" className="w-full h-full absolute inset-0"></div>

                {!isScanning && (
                    <div className="z-10 text-center p-6 text-zinc-400">
                        <Camera size={48} className="mx-auto mb-4 opacity-50" />
                        <p className="text-sm">Camera đang tắt</p>
                    </div>
                )}
            </div>

            {/* Error Message */}
            {error && (
                <div className="mt-4 p-3 bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 text-sm rounded-lg flex items-center gap-2">
                    <AlertCircle size={16} className="shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {/* Controls */}
            <div className="mt-4 grid grid-cols-2 gap-3">
                {!isScanning ? (
                    <button
                        onClick={startScan}
                        className="flex items-center justify-center gap-2 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold transition-colors shadow-lg shadow-emerald-500/20"
                    >
                        <Camera size={20} />
                        Bật Camera
                    </button>
                ) : (
                    <button
                        onClick={stopScan}
                        className="flex items-center justify-center gap-2 py-3 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold transition-colors shadow-lg shadow-rose-500/20"
                    >
                        <StopCircle size={20} />
                        Tắt Camera
                    </button>
                )}

                <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center justify-center gap-2 py-3 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 rounded-xl font-bold hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
                >
                    <ImageIcon size={20} />
                    Chọn Ảnh
                    <input
                        type="file"
                        ref={fileInputRef}
                        className="hidden"
                        accept="image/*"
                        onChange={handleFileUpload}
                    />
                </button>
            </div>

            <p className="text-xs text-zinc-400 text-center mt-4 italic">
                Nếu camera không hoạt động, hãy thử tính năng "Chọn Ảnh" để quét mã có sẵn.
            </p>
        </div>
    );
}
