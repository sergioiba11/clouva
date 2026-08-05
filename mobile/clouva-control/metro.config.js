const { getDefaultConfig } = require("expo/metro-config");

/** @type {import("expo/metro-config").MetroConfig} */
const config = getDefaultConfig(__dirname);

// Expo SDK 53+ enables package.json exports resolution by default. The
// Supabase realtime dependency can otherwise resolve its Node `ws` entry,
// which imports the Node-only `stream` module during an Android bundle.
// Disabling exports resolution lets Metro select the React Native/browser
// entry and keeps the APK free of Node polyfills.
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
