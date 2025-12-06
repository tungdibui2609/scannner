import { NextResponse } from "next/server";
import { findUserWithRow, updateUserStatus, updateUserLastSeen } from "@/lib/googleSheets";
import { USER_SHEET_ID, USER_SHEET_RANGE } from "@/config/sheets";
import { getVNTimestamp } from "@/lib/vnDateTime";

export async function POST(request: Request) {
    try {
        const { username, password } = await request.json();

        if (!username || !password) {
            return NextResponse.json({ message: "Thiếu tài khoản hoặc mật khẩu" }, { status: 400 });
        }

        // Xác thực với Google Sheet (kèm vị trí hàng)
        const found = await findUserWithRow(USER_SHEET_ID, USER_SHEET_RANGE, username);
        if (!found || found.user.password !== password) {
            return NextResponse.json({ message: "Sai tài khoản hoặc mật khẩu" }, { status: 401 });
        }

        // Chặn đăng nhập nếu tài khoản bị vô hiệu hóa
        if (String(found.user.status || "").toLowerCase() === "disabled") {
            return NextResponse.json({ message: "Tài khoản đã bị vô hiệu hóa" }, { status: 403 });
        }

        // Cập nhật trạng thái online và lastseen khi đăng nhập
        try {
            const tabName = USER_SHEET_RANGE.split("!")[0];
            await updateUserStatus(USER_SHEET_ID, tabName, found.header, found.rowIndex, "online");
            await updateUserLastSeen(USER_SHEET_ID, tabName, found.header, found.rowIndex, getVNTimestamp());
        } catch { }

        // Dynamic Permissions (RBAC)
        let allowedPaths: string[] = [];
        let blockedPaths: string[] = [];
        let redirectTo = "";
        try {
            const { getRolePermissions } = await import("@/lib/googleSheets");
            const allPermissions = await getRolePermissions(USER_SHEET_ID);

            const userRoles = [found.user.role, ...(found.user.roles || [])].filter(Boolean).map(r => r!.toLowerCase());
            const matched = allPermissions.filter(p => userRoles.includes(p.role.toLowerCase()));

            if (matched.length > 0) {
                // Merge permissions
                allowedPaths = Array.from(new Set(matched.flatMap(p => p.allowedPaths)));
                blockedPaths = Array.from(new Set(matched.flatMap(p => p.blockedPaths)));
                // Use the first non-empty redirect, or default to dashboard
                redirectTo = matched.find(p => p.redirectTo)?.redirectTo || "/dashboard";
                if (redirectTo === "/login") redirectTo = "/dashboard";
            }
        } catch (e) {
            console.error("Failed to fetch permissions:", e);
        }

        const displayName = found.user.name || found.user.username;
        const res = NextResponse.json({
            ok: true,
            name: displayName,
            username: found.user.username,
            role: found.user.role || "Nhân viên",
            roles: found.user.roles || [], // Phân quyền từ cột D
            avatar: found.user.avatar || null,
            allowedPaths,
            blockedPaths,
            redirectTo
        });

        // Auth flag cookie
        res.cookies.set("wms_auth", "1", {
            httpOnly: true,
            sameSite: "lax",
            path: "/",
            maxAge: 60 * 60 * 24 * 7,
            secure: process.env.NODE_ENV === "production",
        });
        // User identity cookie (read by middleware for audit). Keep JSON minimal.
        const userPayload = encodeURIComponent(JSON.stringify({
            username: found.user.username,
            name: displayName,
            role: found.user.role,
            roles: found.user.roles
        }));
        res.cookies.set("wms_user", userPayload, {
            httpOnly: true, // server-only; UI already receives name in response
            sameSite: "lax",
            path: "/",
            maxAge: 60 * 60 * 24 * 7,
            secure: process.env.NODE_ENV === "production",
        });

        if (allowedPaths.length > 0 || blockedPaths.length > 0) {
            const permPayload = encodeURIComponent(JSON.stringify({
                allowedPaths,
                blockedPaths,
                redirectTo
            }));

            res.cookies.set("wms_permissions", permPayload, {
                httpOnly: true,
                sameSite: "lax",
                path: "/",
                maxAge: 60 * 60 * 24 * 7,
                secure: process.env.NODE_ENV === "production",
            });
        } else {
            // Clear cookie if no permissions found (unrestricted access)
            res.cookies.set("wms_permissions", "", {
                httpOnly: true,
                path: "/",
                maxAge: 0
            });
        }

        return res;
    } catch {
        return NextResponse.json({ message: "Yêu cầu không hợp lệ" }, { status: 400 });
    }
}
