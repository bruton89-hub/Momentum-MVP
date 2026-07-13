import React, { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
  cancelAnimation,
} from "react-native-reanimated";
import { COLORS, SPACING } from "@/constants/theme";

/**
 * Full-screen feed skeleton mirroring the real overlay layout — avatar +
 * text lines bottom-left, action rail bottom-right — so the loaded feed
 * doesn't "jump". One shared opacity pulse drives every block (single
 * UI-thread animation, zero React re-renders).
 */
export default function FeedSkeleton({ height }: { height?: number }) {
  const pulse = useSharedValue(0.4);

  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.4, { duration: 700, easing: Easing.inOut(Easing.quad) })
      ),
      -1
    );
    return () => cancelAnimation(pulse);
  }, [pulse]);

  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <View
      accessibilityLabel="Loading highlights"
      accessibilityRole="progressbar"
      style={[styles.page, height ? { height } : styles.fill]}
    >
      {/* Bottom-left: athlete info placeholder */}
      <Animated.View style={[styles.infoStack, pulseStyle]}>
        <View style={styles.avatarRing}>
          <View style={styles.avatar} />
        </View>
        <View style={[styles.line, { width: "48%", height: 14 }]} />
        <View style={[styles.line, { width: "34%" }]} />
        <View style={[styles.line, { width: "62%" }]} />
      </Animated.View>

      {/* Bottom-right: action rail placeholder */}
      <Animated.View style={[styles.rail, pulseStyle]}>
        <View style={styles.railBtn} />
        <View style={styles.railBtn} />
        <View style={styles.railBtn} />
        <View style={styles.railBtn} />
        <View style={[styles.railBtn, styles.railBtnAccent]} />
      </Animated.View>

      {/* Momentum accent bar — brand pulse at the bottom */}
      <Animated.View style={[styles.accentBar, pulseStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: COLORS.surfaceDeep,
    justifyContent: "flex-end",
  },
  fill: { flex: 1 },
  infoStack: {
    position: "absolute",
    left: SPACING.lg,
    bottom: SPACING.xxl + SPACING.lg,
    gap: SPACING.sm + 2,
  },
  avatarRing: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: COLORS.cardBorder,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: SPACING.xs,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.card,
  },
  line: {
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.card,
  },
  rail: {
    position: "absolute",
    right: SPACING.md,
    bottom: SPACING.xxl + SPACING.lg,
    alignItems: "center",
    gap: SPACING.lg,
  },
  railBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.card,
  },
  railBtnAccent: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.accentFaint,
    borderWidth: 1,
    borderColor: COLORS.accentBorderFaint,
  },
  accentBar: {
    height: 3,
    width: "26%",
    backgroundColor: COLORS.accent,
    marginBottom: 1,
  },
});
