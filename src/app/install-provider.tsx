"use client";

import { createContext, useContext, useEffect, useState } from "react";

type InstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
const InstallContext = createContext<{
  available: boolean; standalone: boolean; message: string; install: () => Promise<void>;
}>({ available: false, standalone: false, message: "", install: async () => {} });

// Keep the browser's one-use prompt across client navigation from Options.
export function InstallProvider({ children }: { children: React.ReactNode }) {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const display = window.matchMedia("(display-mode: standalone)");
    const update = () => setStandalone(display.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    const ready = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    const installed = () => { setPrompt(null); setMessage("Bunch was added. Open it from your home screen."); };
    update();
    display.addEventListener("change", update);
    window.addEventListener("beforeinstallprompt", ready);
    window.addEventListener("appinstalled", installed);
    return () => {
      display.removeEventListener("change", update);
      window.removeEventListener("beforeinstallprompt", ready);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);
  async function install() {
    if (!prompt) return;
    setPrompt(null);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      setMessage(choice.outcome === "accepted" ? "Installation requested. Follow your phone’s confirmation, then look for Bunch on your home screen." : "Installation cancelled. You can still use Bunch here or follow the steps below later.");
    } catch {
      setMessage("Use your browser’s menu to add Bunch. Follow the steps below.");
    }
  }
  return <InstallContext.Provider value={{ available: Boolean(prompt), standalone, message, install }}>{children}</InstallContext.Provider>;
}

export function InstallControl() {
  const { available, standalone, message, install } = useContext(InstallContext);
  return <div>
    {standalone ? <p role="status">You’re already using Bunch as a home-screen app.</p> : available ? <button type="button" onClick={install}>Install Bunch</button> : <p>Use the steps for your phone below.</p>}
    {message && <p role="status">{message}</p>}
  </div>;
}
