import { Stack, Redirect } from "expo-router";
import { useAuthStore } from "@/store/authStore";

export default function AuthLayout() {
  const userId = useAuthStore((state) => state.userId);
  const isLoading = useAuthStore((state) => state.isLoading);

  // While auth state is being determined, don't render anything.
  // The splash screen (from _layout.tsx) covers the UI during this window.
  if (isLoading) {
    return null;
  }

  // Already authenticated — go straight to the app.
  if (userId) {
    return <Redirect href="/" />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "slide_from_right",
        contentStyle: { backgroundColor: "#000000" },
      }}
    />
  );
}
