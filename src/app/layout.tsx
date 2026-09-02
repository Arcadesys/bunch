import type { Metadata } from "next";
import "./styles.css";

const themeScript = `(() => {
  try {
    const savedTheme = window.localStorage.getItem("system-theme");
    document.documentElement.dataset.theme = ["dark", "light", "system"].includes(savedTheme) ? savedTheme : "dark";
  } catch {
    document.documentElement.dataset.theme = "dark";
  }
})();`;

export const metadata: Metadata = {
  title: "System — private coverage record",
  description: "A private, user-confirmed coverage record.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
