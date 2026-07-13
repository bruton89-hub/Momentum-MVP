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

const SCREEN_W = Dimensions.get("window").width;
/** Matches PostGridThumb's 3-column cell math so loading → loaded causes no shift. */
const CELL = (SCREEN_W - SPACING.lg * 2 - SPACING.sm * 2) / 3;

/**
 * Skeleton for the profile post grid — nine pulsing cells laid out with the
 * exact metrics of the real grid, so content appears without layout shift.
 * One shared opacity pulse (UI thread) drives every cell.
 */
export default function ProfileGridSkeleton() {
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
      style={[styles.grid, pulseStyle]}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading highlights"
    >
      {Array.from({ length: 9 }).map((_, index) => (
        <View key={index} style={styles.cell} />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACING.sm,
  },
  cell: {
    width: CELL,
    height: CELL,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.card,
  },
});
