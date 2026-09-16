import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/components/auth-provider";
import { ClouvaAppShell } from "@/components/clouva/ClouvaAppShell";

// Global browser identity belongs to the CLOUVA platform. The artist identity
// has its own canonical entity at /clouva.
export const metadata: Metadata = {
  metadataBase: new URL("https://clouva.com.ar"),
  title: "CLOUVA — Plataforma creativa | Vida de Flows",
  description: "CLOUVA es una plataforma creativa que conecta música, identidad, moda, 3D, Creator, Market, Mi Spot e inteligencia artificial en un mismo universo.",
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
    type: "website",
    title: "CLOUVA — Plataforma creativa | Vida de Flows",
    description: "CLOUVA es una plataforma creativa que conecta música, identidad, moda, 3D, Creator, Market, Mi Spot e inteligencia artificial en un mismo universo.",
    url: "https://clouva.com.ar/",
  },
  twitter: {
    card: "summary_large_image",
    title: "CLOUVA — Plataforma creativa | Vida de Flows",
    description: "CLOUVA es una plataforma creativa que conecta música, identidad, moda, 3D, Creator, Market, Mi Spot e inteligencia artificial en un mismo universo.",
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
