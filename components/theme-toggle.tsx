"use client";
import { useTheme } from "next-themes";
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return <button className="panel px-3 py-2 text-sm" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>Tema: {theme === "dark" ? "Oscuro" : "Claro"}</button>;
}
