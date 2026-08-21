import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Twofold Game Night", description: "A private virtual game-night space for couples.", manifest: "/manifest.webmanifest", icons: { icon: "/favicon.svg", shortcut: "/favicon.svg", apple: "/favicon.svg" }, appleWebApp: { capable: true, title: "Twofold" } };
export const viewport: Viewport = { themeColor: "#6d3d78" };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
