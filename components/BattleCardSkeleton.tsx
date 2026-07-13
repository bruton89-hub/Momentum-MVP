import React, { useEffect } from "react";
import { View, StyleSheet, Dimensions } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
  cancelAnimation,
} from "react-native-reanimated";
import { COLORS, SPACING, RADIUS } from "@/constants/theme";

const { width: SCREEN_W } = Dimensions.get("window");
const THUMB_W = (SCREEN_W - SPACING.md * 2 - SPACING.lg * 2 - 60) / 2;
const THUMB_H = Math.round(THUMB_W * 1.35);

/**
 * Skeleton matching the BattleCard layout (status row → two thumbs + VS →
 * vote bar) so loaded cards appear without layout shift. One shared
 * UI-thread pulse drives all blocks.
 */
export default function BattleCardSkeleton({ count = 2 }: { count?: number }) {
  const pulse = useSharedValue(0.45);

  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 650, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.45, { duration: 650, easing: Easing.inOut(Easing.quad) })
      ),
      -1
    );
    return () => cancelAnimation(pulse);
  }, [pulse]);

  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      style={pulseStyle}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading battles"
    >
      {Array.from({ length: count }).map((_, index) => (
        <View key={index} style={styles.card}>
          <View style={styles.statusRow}>
            <View style={styles.badge} />
            <View style={styles.badgeSmall} />
          </View>
          <View style={styles.playersRow}>
            <View style={styles.playerCol}>
              <View style={styles.avatar} />
              <View style={styles.nameLine} />
              <View style={styles.thumb} />
            </View>
            <View style={styles.vs} />
            <View style={styles.playerCol}>
              <View style={styles.avatar} />
              <View style={styles.nameLine} />
              <View style={styles.thumb} />
            </View>
          </View>
          <View style={styles.bar} />
        </View>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.lg,
    marginTop: SPACING.md,
    padding: SPACING.md,
  },
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: SPACING.md,
  },
  badge: {
    width: 96,
    height: 20,
    borderRadius: RADIUS.xs,
    backgroundColor: COLORS.surface,
  },
  badgeSmall: {
    width: 40,
    height: 20,
    borderRadius: RADIUS.xs,
    backgroundColor: COLORS.surface,
  },
  playersRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  playerCol: {
    flex: 1,
    alignItems: "center",
    gap: 8,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.surface,
  },
  nameLine: {
    width: "55%",
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.surface,
  },
  thumb: {
    width: THUMB_W,
    height: THUMB_H,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surface,
  },
  vs: {
    width: 34,
    height: 34,
    borderRadius: 17,
    marginHorizontal: 13,
    backgroundColor: COLORS.surface,
  },
  bar: {
    height: 12,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface,
    marginTop: SPACING.md,
  },
});
