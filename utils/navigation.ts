/**
 * Navigation helpers — profile routing
 *
 * Problem: tapping a user's name/avatar/media in PostCard, BattleCard, etc. always
 * called `router.push('/profile/${userId}')`. When userId === currentUserId this
 * pushed the DYNAMIC stack screen (`/profile/[userId]`) instead of switching to
 * the own-profile tab (`/(tabs)/profile`). The stack screen has a back button and
 * sits outside the tab navigator, which makes the Profile tab appear "tied" to
 * the other player after returning.
 *
 * Fix: always route through this helper so own-profile navigations go to the tab
 * and other-profile navigations get pushed onto the root stack.
 */
import type { useRouter } from "expo-router";

type Router = ReturnType<typeof useRouter>;

/**
 * Navigate to an athlete's profile correctly:
 *   - Same user as the viewer → `/(tabs)/profile` (own-profile tab, no back button)
 *   - Different user           → `/profile/${targetUserId}` (stack screen with back)
 *
 * Uses `router.navigate` for own profile (idempotent — won't create duplicate
 * history entries if already on the tab) and `router.push` for others (adds a
 * stack entry so the back button returns to the previous screen).
 */
export function openAthleteProfile(
  router: Router,
  targetUserId: string | null | undefined,
  currentUserId: string | null | undefined
): void {
  if (!targetUserId) return;
  if (targetUserId === currentUserId) {
    router.navigate("/(tabs)/profile" as never);
  } else {
    router.push(`/profile/${targetUserId}` as never);
  }
}
