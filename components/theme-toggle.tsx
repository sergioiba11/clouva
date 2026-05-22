"use client";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const dark = theme !== "light";
  return <button aria-label="toggle theme" className="rounded-full border border-[var(--line)] bg-[var(--card)] p-2" onClick={() => setTheme(dark ? "light" : "dark")}>{dark ? <Sun size={14} /> : <Moon size={14} />}</button>;
}
