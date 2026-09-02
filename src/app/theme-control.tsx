"use client";

import { useEffect, useRef } from "react";

type ThemeChoice = "dark" | "light" | "system";

const storageKey = "system-theme";

function isThemeChoice(value: string | null): value is ThemeChoice {
  return value === "dark" || value === "light" || value === "system";
}

export function ThemeControl() {
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem(storageKey);
    const theme = isThemeChoice(savedTheme) ? savedTheme : "dark";
    document.documentElement.dataset.theme = theme;
    if (selectRef.current) selectRef.current.value = theme;
  }, []);

  function changeTheme(theme: ThemeChoice) {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(storageKey, theme);
  }

  return (
    <label className="theme-control">
      <span>Appearance</span>
      <select
        ref={selectRef}
        defaultValue="dark"
        onChange={(event) => changeTheme(event.target.value as ThemeChoice)}
      >
        <option value="dark">Dark (preferred)</option>
        <option value="system">Use device setting</option>
        <option value="light">Light</option>
      </select>
    </label>
  );
}
