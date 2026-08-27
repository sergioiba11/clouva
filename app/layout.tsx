import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/components/auth-provider";
import { CurrentPlayerProvider } from "@/components/current-player-provider";
import { ActiveAvatarHydrator } from "@/components/avatar-engine/ActiveAvatarHydrator";
import { GlobalSpotifyPlayer } from "@/components/GlobalSpotifyPlayer";
import { GlobalClouvaAIButton } from "@/components/GlobalClouvaAIButton";
import { ClouvaAIAssistantProvider } from "@/components/clouva-ai/ClouvaAIAssistantProvider";
import { SpotifyPlaybackProvider } from "@/components/music/SpotifyPlaybackProvider";

// Browser identity is global: the tab always carries the CLOUVA brand and official clover icon.
export const metadata: Metadata = {
  title: "Clouva Vida de Flows",
  description: "Vida de flows. Directamente desde el southside.",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
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
            <CurrentPlayerProvider>
              <SpotifyPlaybackProvider>
                <ClouvaAIAssistantProvider>
                  <ActiveAvatarHydrator />
                  {children}
                  <GlobalClouvaAIButton />
                  <GlobalSpotifyPlayer />
                </ClouvaAIAssistantProvider>
              </SpotifyPlaybackProvider>
            </CurrentPlayerProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
