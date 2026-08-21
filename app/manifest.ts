import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Twofold Game Night",
    short_name: "Twofold",
    description: "Private synchronized game nights for couples.",
    start_url: "/",
    display: "standalone",
    background_color: "#fff9f7",
    theme_color: "#6d3d78",
    icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
