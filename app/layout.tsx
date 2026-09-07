import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/components/auth-provider";
import { CurrentPlayerProvider } from "@/components/current-player-provider";
import { ActiveAvatarHydrator } from "@/components/avatar-engine/ActiveAvatarHydrator";
import { GlobalSpotifyPlayer } from "@/components/GlobalSpotifyPlayer";
import { GlobalClouvaAIButtonGate } from "@/components/GlobalClouvaAIButtonGate";
import { ClouvaSystemTopBarGate } from "@/components/clouva/system/ClouvaSystemTopBarGate";
import { ClouvaAIAssistantProvider } from "@/components/clouva-ai/ClouvaAIAssistantProvider";
import { SpotifyPlaybackProvider } from "@/components/music/SpotifyPlaybackProvider";
import { PlayerBasicsGate } from "@/components/onboarding/PlayerBasicsGate";

// Browser identity is global: the tab always carries the official CLOUVA mark.
export const metadata: Metadata = {
  title: "Clouva Vida de Flows",
  description: "Vida de flows. Directamente desde el southside.",
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
    description: "Premium underground fashion desde Zapala",
    url: "https://clouva.com.ar"
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Anton&display=swap" rel="stylesheet" />
        <script type="module" src="https://unpkg.com/@google/model-viewer@3.5.0/dist/model-viewer.min.js" async />
      </head>
      <body>
        <ThemeProvider>
          <AuthProvider>
            <PlayerBasicsGate>
              <CurrentPlayerProvider>
                <SpotifyPlaybackProvider>
                  <ClouvaAIAssistantProvider>
                    <ActiveAvatarHydrator />
                    <ClouvaSystemTopBarGate />
                    {children}
                    <GlobalClouvaAIButtonGate />
                    <GlobalSpotifyPlayer />
                  </ClouvaAIAssistantProvider>
                </SpotifyPlaybackProvider>
              </CurrentPlayerProvider>
            </PlayerBasicsGate>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
