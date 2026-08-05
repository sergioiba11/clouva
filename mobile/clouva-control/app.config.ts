import type { ExpoConfig } from "expo/config";

const version = process.env.CLOUVA_CONTROL_VERSION ?? "1.0.0";
const buildNumber = Number(process.env.CLOUVA_CONTROL_BUILD_NUMBER ?? "1");

// CLOUVA CONTROL belongs to this single Supabase project. These are public
// client values (never service-role credentials), so a local/CI build remains
// connected even when GitHub variables are not injected.
const CLOUVA_SUPABASE_URL = "https://dpawotcignpexkirhfsk.supabase.co";
const CLOUVA_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_0_fUt2edSzw90ahVNL2AeQ_P9J6wBB4";

const config: ExpoConfig = {
  name: "CLOUVA CONTROL",
  slug: "clouva-control",
  version,
  icon: "./assets/icon.png",
  orientation: "portrait",
  userInterfaceStyle: "dark",
  scheme: "clouvacontrol",
  android: {
    package: "com.clouva.control",
    versionCode: buildNumber,
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#090711",
    },
    permissions: [
      "android.permission.CAMERA",
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.REQUEST_INSTALL_PACKAGES",
      "android.permission.READ_MEDIA_IMAGES"
    ],
  },
  plugins: [
    "expo-web-browser",
    ["expo-secure-store", { configureAndroidBackup: true }],
    ["expo-image-picker", { photosPermission: "CLOUVA CONTROL necesita acceder a imágenes para adjuntar evidencia a un problema.", cameraPermission: "CLOUVA CONTROL necesita la cámara para registrar evidencia visual." }]
  ],
  extra: {
    clouvaApiUrl: process.env.EXPO_PUBLIC_CLOUVA_API_URL ?? "https://clouva.com.ar",
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? CLOUVA_SUPABASE_URL,
    supabasePublishableKey:
      process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
      CLOUVA_SUPABASE_PUBLISHABLE_KEY,
  },
};

export default config;
