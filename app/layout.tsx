import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: "CLOUVA | Live Different",
  description: "Ecosistema CLOUVA: tienda, admin y Mi Flow",
  openGraph: { title: "CLOUVA", description: "Vida de Flows", url: "https://clouva.com.ar" }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="es"><body><ThemeProvider>{children}</ThemeProvider></body></html>;
}
