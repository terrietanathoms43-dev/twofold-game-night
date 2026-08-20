import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Twofold Game Night", description: "A private virtual game-night space for couples." };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
