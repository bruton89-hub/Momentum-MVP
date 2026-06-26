import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, initializeAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";
import { Platform } from "react-native";

function requiredEnv(name: string, value: string | undefined): string {
  if (!value?.trim()) {
    throw new Error(
      `Missing ${name}. Configure the Firebase Web App environment before starting Momentum.`
    );
  }
  return value;
}

const firebaseConfig = {
  apiKey: requiredEnv(
    "EXPO_PUBLIC_FIREBASE_API_KEY",
    process.env.EXPO_PUBLIC_FIREBASE_API_KEY
  ),
  authDomain: requiredEnv(
    "EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN",
    process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN
  ),
  projectId: requiredEnv(
    "EXPO_PUBLIC_FIREBASE_PROJECT_ID",
    process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID
  ),
  storageBucket: requiredEnv(
    "EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET",
    process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET
  ),
  messagingSenderId: requiredEnv(
    "EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
    process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
  ),
  appId: requiredEnv(
    "EXPO_PUBLIC_FIREBASE_APP_ID",
    process.env.EXPO_PUBLIC_FIREBASE_APP_ID
  ),
};

const expectedProjectId = process.env.EXPO_PUBLIC_EXPECTED_FIREBASE_PROJECT_ID;
if (expectedProjectId && firebaseConfig.projectId !== expectedProjectId) {
  throw new Error(
    `Firebase project mismatch: expected ${expectedProjectId}, received ${firebaseConfig.projectId}.`
  );
}

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Auth with platform-appropriate persistence
function createAuth() {
  if (Platform.OS === "web") {
    return getAuth(app);
  }
  // React Native: AsyncStorage-backed persistence.
  // Wrapped in try/catch to survive Expo hot-reload re-initialization.
  try {
    const { getReactNativePersistence } = require("firebase/auth") as {
      getReactNativePersistence: (s: unknown) => unknown;
    };
    const AsyncStorage =
      require("@react-native-async-storage/async-storage").default;
    return initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage) as never,
    });
  } catch {
    return getAuth(app);
  }
}

export const auth = createAuth();
export const db = getFirestore(app);
export const storage = getStorage(app);
// Region must match the Cloud Functions deployment region (see functions/src/index.ts).
export const functions = getFunctions(app, "us-central1");
