import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/components/auth-provider";
import { CurrentPlayerProvider } from "@/components/current-player-provider";
import { ActiveAvatarHydrator } from "@/components/avatar-engine/ActiveAvatarHydrator";
import { GlobalSpotifyPlayer } from "@/components/GlobalSpotifyPlayer";
import { GlobalClouvaAIButton } from "@/components/GlobalClouvaAIButton";
import { ClouvaAIAssistantProvider } from "@/components/clouva-ai/ClouvaAIAssistantProvider";

export const metadata: Metadata = {
  title: "CLOUVA | Premium Underground",
  description: "Vida de flows. Directamente desde el southside.",
  openGraph: {
    title: "CLOUVA",
    description: "Premium underground fashion desde Zapala",
    url: "https://clouva.com.ar"
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Anton&display=swap" rel="stylesheet" />
        <script type="module" src="https://unpkg.com/@google/model-viewer@3.5.0/dist/model-viewer.min.js" async />
      </head>
      <body>
        <ThemeProvider>
          <AuthProvider>
            <CurrentPlayerProvider>
              <ClouvaAIAssistantProvider>
                <ActiveAvatarHydrator />
                {children}
                <GlobalClouvaAIButton />
                <GlobalSpotifyPlayer />
              </ClouvaAIAssistantProvider>
            </CurrentPlayerProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
