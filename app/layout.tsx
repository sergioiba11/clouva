import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/components/auth-provider";
import { ClouvaAppShell } from "@/components/clouva/ClouvaAppShell";

// Browser identity is global: the tab always carries the official CLOUVA mark.
export const metadata: Metadata = {
  title: "Clouva Vida de Flows",
  description: "CLOUVA — Vida de flows. Player, Creator, Market, Mi Spot, música, moda, 3D y AI en un mismo universo creativo.",
  icons: {
    icon: [
      {
        url: "/assets/clouva/brand/logo-official-dark.png?v=official-20260907",
        type: "image/png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/assets/clouva/brand/logo-official-light.png?v=official-20260907",
        type: "image/png",
        media: "(prefers-color-scheme: dark)",
      },
    ],
    shortcut: "/assets/clouva/brand/logo-official-light.png?v=official-20260907",
    apple: "/assets/clouva/brand/logo-official-dark.png?v=official-20260907",
  },
  openGraph: {
    title: "Clouva Vida de Flows",
    description: "CLOUVA — Vida de flows. Un universo creativo para Player, música, moda, 3D, Market, Mi Spot y AI.",
    url: "https://clouva.com.ar",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Anton&display=swap" rel="stylesheet" />
      </head>
      <body>
        <ThemeProvider>
          <AuthProvider>
            <ClouvaAppShell>{children}</ClouvaAppShell>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
