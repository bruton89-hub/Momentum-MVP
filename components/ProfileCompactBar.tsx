import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  interpolate,
  Extrapolation,
  useAnimatedStyle,
  SharedValue,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { COLORS, SPACING, FONTS, TYPE, SCRIMS } from "@/constants/theme";
import AvatarImage from "./AvatarImage";

export const COMPACT_BAR_HEIGHT = 52;

/** Scroll offsets over which the compact bar fades in. */
const COLLAPSE_START = 90;
const COLLAPSE_END = 150;

interface Props {
  username: string;
  avatarUri?: string | null;
  verified?: boolean;
  scrollY: SharedValue<number>;
  /** Always-visible controls (back / sign-out) at the bar edges. */
  left?: React.ReactNode;
  right?: React.ReactNode;
}

/**
 * Collapsing profile navigation bar. Sits above the profile list; as the large
 * header scrolls away, a compact avatar + name fades into the bar (scroll-linked,
 * UI-thread only — no timers, no React state). Edge controls stay interactive
 * at all times; the collapsing center never intercepts touches.
 */
export default function ProfileCompactBar({
  username,
  avatarUri,
  verified = false,
  scrollY,
  left,
  right,
}: Props) {
  // SAFE AREA: keep the edge controls (back / sign-out) clear of display
  // cutouts and rounded corners on every device — never less than the
  // design's own padding.
  const insets = useSafeAreaInsets();
  const padLeft = Math.max(SPACING.md, insets.left);
  const padRight = Math.max(SPACING.md, insets.right);

  const backgroundStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      scrollY.value,
      [COLLAPSE_START, COLLAPSE_END],
      [0, 1],
      Extrapolation.CLAMP
    ),
  }));

  // The bar now floats over the profile banner, so the back / sign-out icons
  // can land on bright artwork. A scrim keeps them legible at rest and hands
  // off to the solid background as that fades in — the two never stack.
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      scrollY.value,
      [COLLAPSE_START, COLLAPSE_END],
      [1, 0],
      Extrapolation.CLAMP
    ),
  }));

  const titleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      scrollY.value,
      [COLLAPSE_START + 20, COLLAPSE_END],
      [0, 1],
      Extrapolation.CLAMP
    ),
    transform: [
      {
        translateY: interpolate(
          scrollY.value,
          [COLLAPSE_START + 20, COLLAPSE_END],
          [10, 0],
          Extrapolation.CLAMP
        ),
      },
    ],
  }));

  return (
    <View
      style={[
        styles.bar,
        {
          top: insets.top,
          paddingLeft: padLeft,
          paddingRight: padRight,
        },
      ]}
      pointerEvents="box-none"
    >
      {/* Readability scrim over the banner, fades out as the solid bar arrives */}
      <Animated.View style={[styles.scrimLayer, scrimStyle]} pointerEvents="none">
        <LinearGradient colors={SCRIMS.top} style={StyleSheet.absoluteFill} />
      </Animated.View>

      {/* Solid background + hairline, fades in as the header collapses */}
      <Animated.View style={[styles.background, backgroundStyle]} pointerEvents="none" />

      <View style={styles.side}>{left}</View>

      <Animated.View style={[styles.title, titleStyle]} pointerEvents="none">
        <AvatarImage uri={avatarUri} username={username} size={26} />
        <Text style={styles.titleText} numberOfLines={1}>
          {username}
        </Text>
        {verified && (
          <MaterialCommunityIcons name="check-decagram" size={14} color={COLORS.accent} />
        )}
      </Animated.View>

      <View style={styles.side}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    height: COMPACT_BAR_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    // horizontal padding applied inline — safe-area dependent.
    //
    // HIT TESTING: this must sit on a native top layer, not merely paint over
    // the list. The profile header and grid underneath contain image- and
    // AVPlayer-backed views, and on iOS those can win hit testing against an
    // overlaid sibling even when it is visually on top — which silently ate
    // taps on Back and Sign out. PostDetailModal's top bar hit the identical
    // problem; these values mirror the fix that resolved it there.
    zIndex: 1000,
    elevation: 1000,
  },
  scrimLayer: {
    ...StyleSheet.absoluteFillObject,
    // Extends past the bar so the gradient's tail fades out gracefully rather
    // than terminating on a hard edge mid-banner.
    bottom: -SPACING.lg,
  },
  background: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
  },
  // Edge controls are the only interactive part of the bar, so they get their
  // own layer above both scrims and the collapsing centre.
  side: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    zIndex: 1001,
    elevation: 1001,
  },
  title: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: SPACING.sm,
  },
  titleText: {
    color: COLORS.textPrimary,
    fontSize: TYPE.callout,
    fontWeight: FONTS.bold,
    letterSpacing: 0.2,
    flexShrink: 1,
  },
});
