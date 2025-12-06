import ScannerClient from "./ScannerClient";
import { Metadata } from "next";

export const metadata: Metadata = {
    title: "Scanner - AnyWarehouse",
    manifest: "/manifest-scanner.json",
};

export default function ScannerPage() {
    // Static Shell: No server-side auth check here.
    // Auth is handled client-side in ScannerClient.
    return <ScannerClient isAuthenticated={false} />;
}
