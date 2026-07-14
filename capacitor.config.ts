import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.clouva.app",
  appName: "CLOUVA",
  webDir: "www",
  server: {
    // La app carga la versión publicada real de Clouva, no un bundle
    // estático local (el proyecto es Next.js con SSR/API routes, no
    // se puede exportar como sitio estático).
    url: "https://clouva.com.ar",
    cleartext: false,
    androidScheme: "https",
  },
  android: {
    allowMixedContent: false,
    // Reduce el trabajo de la WebView en celulares de gama media/baja
    backgroundColor: "#0a0f10",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: "#0a0f10",
      androidSplashResourceName: "splash",
      showSpinner: false,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
