export default {
  expo: {
    name: "Momentum",
    slug: "momentum-app",
    scheme: "momentum",
    version: "1.0.1",
    orientation: "portrait",
    // Top-level icon used by Expo Go and as the default for all platforms
    icon: "./assets/icon.png",
    splash: {
      image: "./assets/splash.png",
      resizeMode: "contain",
      backgroundColor: "#000000",
    },
    jsEngine: "hermes",
    ios: {
      // Explicit iOS icon ensures EAS uses this exact file — no fallback to default.
      // Must be 1024×1024 PNG, RGB (no alpha), no transparency, no rounded corners
      // applied by the developer (iOS applies its own corner mask at runtime).
      icon: "./assets/icon.png",
      bundleIdentifier: "com.momentumapp.sports",
      buildNumber: "33",
      supportsTablet: false,
      googleServicesFile: process.env.IOS_GOOGLE_SERVICES_FILE || "./GoogleService-Info.plist",
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSPhotoLibraryUsageDescription:
          "Allow Momentum to access your photo library to upload posts.",
        NSCameraUsageDescription:
          "Allow Momentum to use your camera to create posts.",
        NSMicrophoneUsageDescription:
          "Allow Momentum to use your microphone when recording video.",
      },
    },
    android: {
      package: "com.momentumapp.mvp",
      versionCode: 25,
      googleServicesFile: process.env.ANDROID_GOOGLE_SERVICES_FILE || "./google-services.json",
      adaptiveIcon: {
        // Dedicated adaptive icon — foreground drawn on top of backgroundColor.
        // Using a separate file from icon.png allows Android to apply its own
        // safe-zone cropping without affecting the iOS icon.
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#000000",
      },
    },
    web: {
      favicon: "./assets/favicon.png",
    },
    plugins: [
      "expo-router",
      [
        "expo-image-picker",
        {
          photosPermission:
            "Allow Momentum to access your photo library.",
          cameraPermission: "Allow Momentum to use your camera.",
          microphonePermission:
            "Allow Momentum to use your microphone.",
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      eas: {
        projectId:
          process.env.EAS_PROJECT_ID ||
          "4148ae9f-36be-4364-aa69-09cbf0ead6ae",
      },
    },
  },
};
