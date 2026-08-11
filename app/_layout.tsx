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
import { canCommitProfile } from "@/utils/remediationGuards";

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const setUserId = useAuthStore((state) => state.setUserId);
  const setProfile = useAuthStore((state) => state.setProfile);
  const setLoading = useAuthStore((state) => state.setLoading);
  const isLoading = useAuthStore((state) => state.isLoading);

  // ── Firebase auth listener ─────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        // Never carry decorative identity from one account into another while
        // the new profile request is in flight.
        if (useAuthStore.getState().userId !== user.uid) setProfile(null);
        setUserId(user.uid);
        // Auth identity is enough to enter the app. Profile data is decorative
        // for Home and can hydrate without extending the native splash screen.
        setLoading(false);
        fetchUserProfile(user.uid)
          .then((profile) => {
            if (canCommitProfile(user.uid, auth.currentUser?.uid ?? null)) {
              setProfile(profile);
            }
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
          {/* Expanded Discover rails — the "See All" destinations */}
          <Stack.Screen name="discover/[section]" />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
