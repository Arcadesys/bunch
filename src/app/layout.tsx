import type { Metadata, Viewport } from "next";
import { InstallProvider } from "./install-provider";
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
  title: "Bunch — your private companion",
  description: "A private, user-confirmed catch-up for notes, todos, decisions, threads, and switch history.",
  icons: { icon: "/bunch-barrel-monkeys.png", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Bunch", statusBarStyle: "default" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#19121f" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body><InstallProvider>{children}</InstallProvider></body>
    </html>
  );
}
