import type { ExpoConfig } from "expo/config";

const version = process.env.CLOUVA_CONTROL_VERSION ?? "1.0.0";
const buildNumber = Number(process.env.CLOUVA_CONTROL_BUILD_NUMBER ?? "1");

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
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
    supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
  },
};

export default config;
