import React, { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/config/firebase";
import { useAuthStore } from "@/store/authStore";
import { fetchUserProfile } from "@/hooks/useProfile";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const { setUserId, setProfile, setLoading, isLoading } = useAuthStore();

  // ── Firebase auth listener ─────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUserId(user.uid);
        // Auth identity is enough to enter the app. Profile data is decorative
        // for Home and can hydrate without extending the native splash screen.
        setLoading(false);
        fetchUserProfile(user.uid)
          .then((profile) => {
            if (auth.currentUser?.uid === user.uid) setProfile(profile);
          })
          .catch((error) => {
            console.error("[RootLayout] profile hydration failed", error);
          });
      } else {
        setUserId(null);
        setProfile(null);
        setLoading(false);
      }
    });
    return unsub;
  }, [setUserId, setProfile, setLoading]);

  // ── Hide splash once auth state is resolved ────────────────────────────────
  useEffect(() => {
    if (!isLoading) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [isLoading]);

  // NOTE: No redirect logic here. Route groups are transparent in URLs so
  // segments[0] === "(auth)" is always false. Redirects live in each group's
  // _layout.tsx using <Redirect>, which is the correct Expo Router v3 pattern.

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" backgroundColor="#000000" />
        <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
          <Stack.Screen name="(auth)" options={{ animation: "fade" }} />
          <Stack.Screen name="(tabs)" options={{ animation: "fade" }} />
          {/* Dynamic player profile — matched by /profile/[userId] links in PostCard */}
          <Stack.Screen name="profile/[userId]" />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
