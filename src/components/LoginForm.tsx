"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useUI } from "@/components/UIProvider";

interface LoginFormProps {
    onSuccess?: () => void;
}

export default function LoginForm({ onSuccess }: LoginFormProps) {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const ui = useUI();
    const toastTimer = useRef<any>(null);
    const year = new Date().getFullYear();
    const router = useRouter();

    const showToast = (message: string, type: "error" | "success" = "error") => {
        try { if (toastTimer.current) clearTimeout(toastTimer.current); } catch { }
        ui.toast(message, type);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        ui.startLoading("Đang đăng nhập...");
        try {
            const res = await fetch("/api/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                const msg = (data && data.message) ? data.message : "Đăng nhập thất bại";
                showToast(msg, "error");
                setLoading(false);
                ui.stopLoading();
                return;
            }
            try {
                localStorage.setItem("userUsername", username);
                if (data?.name) localStorage.setItem("userName", data.name);
                if (data?.role) localStorage.setItem("userRole", data.role);
                if (data?.roles) localStorage.setItem("userRoles", JSON.stringify(data.roles));
                if (data?.avatar) localStorage.setItem("userAvatar", data.avatar);

                // Dynamic RBAC
                if (data?.allowedPaths) localStorage.setItem("allowedPaths", JSON.stringify(data.allowedPaths));
                if (data?.redirectTo) localStorage.setItem("redirectTo", data.redirectTo);
            } catch { }

            // Dynamic RBAC Redirect (takes precedence)
            const returnUrl = new URLSearchParams(window.location.search).get("returnUrl");
            if (onSuccess) {
                onSuccess();
            } else if (returnUrl) {
                router.push(returnUrl);
            } else if (data?.redirectTo) {
                router.push(data.redirectTo);
            } else {
                router.push("/dashboard");
            }

            setLoading(false);
            ui.stopLoading();
            ui.toast("Đăng nhập thành công", "success");
        } catch (error) {
            showToast("Có lỗi xảy ra", "error");
            setLoading(false);
            ui.stopLoading();
        }
    };

    return (
        <div className="relative min-h-screen w-full flex items-center justify-center px-4 overflow-hidden bg-gradient-to-br from-amber-100 via-orange-100 to-yellow-100 dark:from-amber-950 dark:via-orange-950 dark:to-yellow-950">
            <div className="pointer-events-none absolute -top-32 -left-32 h-80 w-80 rounded-full bg-gradient-to-br from-amber-200/40 to-yellow-200/30 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-gradient-to-tl from-orange-200/35 to-amber-300/25 blur-3xl" />
            <div className="w-full max-w-sm">
                <div className="text-center mb-6">
                    <img src="/logo.png" alt="Logo công ty" className="mx-auto w-[220px] h-auto md:w-[260px] drop-shadow-2xl" />
                </div>
                <div className="rounded-2xl border border-amber-700/60 bg-gradient-to-b from-amber-800 via-amber-900 to-amber-900 shadow-2xl shadow-amber-950/80 backdrop-blur-xl p-6 md:p-8 ring-1 ring-amber-600/40 min-h-[360px]">
                    <div className="text-center mb-6">
                        <h1 className="text-2xl font-bold bg-gradient-to-r from-amber-200 via-yellow-200 to-amber-300 bg-clip-text text-transparent">Hệ Thống Quản Lý Kho</h1>
                        <p className="mt-2 text-sm text-amber-100 whitespace-nowrap">Đăng nhập bằng tài khoản đã được cấp để sử dụng</p>
                    </div>
                    <form className="space-y-5" onSubmit={handleSubmit}>
                        <label htmlFor="username" className="sr-only">Tài khoản</label>
                        <div className="relative">
                            <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-amber-400">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                                    <circle cx="12" cy="7" r="4" />
                                </svg>
                            </span>
                            <input id="username" name="username" type="text" autoComplete="username" required placeholder="Tài khoản" value={username} onChange={(e) => setUsername(e.target.value)} className="w-full rounded-xl border border-amber-700/60 bg-amber-950/70 pl-11 pr-4 py-3.5 text-sm text-amber-100 placeholder-amber-400 shadow-sm hover:border-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-all" />
                        </div>
                        <label htmlFor="password" className="sr-only">Mật khẩu</label>
                        <div className="relative">
                            <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-amber-400">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                </svg>
                            </span>
                            <input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required placeholder="Mật khẩu" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-xl border border-amber-700/60 bg-amber-950/70 pl-11 pr-11 py-3.5 text-sm text-amber-100 placeholder-amber-400 shadow-sm hover:border-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-all" />
                            <button type="button" aria-label="Hiện/ẩn mật khẩu" onClick={() => setShowPassword((v) => !v)} className="absolute inset-y-0 right-3.5 flex items-center text-amber-400 hover:text-amber-300 transition-colors">
                                {showPassword ? (
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                        <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.77 21.77 0 0 1 5.06-6.88" />
                                        <path d="M1 1l22 22" />
                                        <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a21.86 21.86 0 0 1-3.87 5.62" />
                                        <path d="M14.12 9.88a3 3 0 1 1-4.24 4.24" />
                                    </svg>
                                ) : (
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                        <circle cx="12" cy="12" r="3" />
                                    </svg>
                                )}
                            </button>
                        </div>
                        <button type="submit" disabled={loading} className="w-full py-3.5 text-sm font-bold text-amber-950 rounded-xl bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 hover:from-amber-500 hover:via-yellow-500 hover:to-amber-600 active:from-amber-600 active:via-yellow-600 active:to-amber-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-400 focus:ring-offset-amber-900 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-amber-600/40 hover:shadow-xl hover:shadow-amber-500/50 transition-all duration-200">
                            {loading ? "Đang xử lý..." : "Đăng nhập"}
                        </button>
                    </form>
                    <div className="pt-4">
                        <div className="flex flex-col items-center gap-3.5 px-6 md:px-8 py-6">
                            <p className="text-sm text-amber-50 font-semibold tracking-wide whitespace-nowrap">Đơn vị cung cấp giải pháp quản lý kho</p>
                            <img src="/logoanywarehouse.png" alt="Anywarehouse Logo" className="h-28 w-auto opacity-95 hover:opacity-100 transition-all duration-300 drop-shadow-2xl hover:drop-shadow-[0_0_15px_rgba(255,255,255,0.5)]" />
                            <a href="https://anywarehouse.click" target="_blank" rel="noopener noreferrer" className="text-sm text-white hover:text-amber-100 font-bold transition-all duration-200 hover:underline hover:scale-105 inline-block">Anywarehouse.click</a>
                            <p className="text-xs text-amber-100/70 mt-0.5">© {year} Bảo lưu mọi quyền.</p>
                        </div>
                    </div>
                </div>
            </div >
        </div >
    );
}
