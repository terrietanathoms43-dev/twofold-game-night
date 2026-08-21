import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Twofold Game Night",
    short_name: "Twofold",
    id: "/twofold-game-night",
    description: "Private synchronized game nights for couples.",
    start_url: "/",
    display: "standalone",
    background_color: "#fff9f7",
    theme_color: "#6d3d78",
    icons: [
      { src: "/twofold-icon-192-v2.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/twofold-icon-512-v2.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/twofold-icon-512-v2.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
