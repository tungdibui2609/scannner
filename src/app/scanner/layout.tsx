import type { Metadata } from "next";

export const metadata: Metadata = {
    manifest: "/manifest-scanner.json",
};

export default function ScannerLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <>
            {children}
        </>
    );
}
