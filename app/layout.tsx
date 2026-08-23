import type { Metadata, Viewport } from "next";
import ClientErrorReporter from "./ClientErrorReporter";
import "./globals.css";
export const metadata: Metadata = { title: "Twofold Game Night", description: "A private virtual game-night space for couples.", manifest: "/manifest.webmanifest", icons: { icon: [{ url: "/favicon.svg", type: "image/svg+xml" }, { url: "/twofold-icon-192-v2.png", sizes: "192x192", type: "image/png" }], shortcut: "/favicon.svg", apple: [{ url: "/twofold-apple-touch-v2.png", sizes: "180x180", type: "image/png" }] }, appleWebApp: { capable: true, title: "Twofold" } };
export const viewport: Viewport = { themeColor: "#6d3d78" };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}<ClientErrorReporter /></body></html>; }
