import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Bunch — your private companion",
    short_name: "Bunch",
    description: "Your private catch-up, people, notes, and todos.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#19121f",
    theme_color: "#19121f",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
