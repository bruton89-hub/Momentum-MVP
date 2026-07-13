import React, { useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useReducedMotion,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { COLORS, FONTS, RADIUS } from "@/constants/theme";

interface Props {
  pctA: number;
  pctB: number;
  totalVotes: number;
  nameA?: string;
  nameB?: string;
  /** Track height. Card uses 12, detail uses 10. */
  height?: number;
}

/**
 * The shared vote-split bar (Momentum green vs electric blue) used by
 * BattleCard and BattleDetailModal — previously duplicated with drifting
 * colors. The split animates smoothly when counts change (UI thread), and
 * jumps instantly under reduced motion.
 */
export default function VoteBar({
  pctA,
  pctB,
  totalVotes,
  nameA = "Player A",
  nameB = "Player B",
  height = 12,
}: Props) {
  const reducedMotion = useReducedMotion();
  const pct = useSharedValue(pctA);

  useEffect(() => {
    pct.value = reducedMotion
      ? pctA
      : withTiming(pctA, { duration: 450, easing: Easing.out(Easing.cubic) });
  }, [pctA, reducedMotion, pct]);

  const fillA = useAnimatedStyle(() => ({ flex: Math.max(0.0001, pct.value) }));
  const fillB = useAnimatedStyle(() => ({ flex: Math.max(0.0001, 100 - pct.value) }));

  return (
    <View
      style={styles.wrap}
      accessible
      accessibilityLabel={`${nameA} ${pctA} percent, ${nameB} ${pctB} percent, ${totalVotes} total votes`}
    >
      <View style={styles.labels}>
        <Text style={styles.pctA}>{pctA}%</Text>
        <Text style={styles.total}>{totalVotes.toLocaleString()} votes</Text>
        <Text style={styles.pctB}>{pctB}%</Text>
      </View>
      <View style={[styles.track, { height, borderRadius: height / 2 }]}>
        <Animated.View style={[styles.fillA, fillA]} />
        <Animated.View style={[styles.fillB, fillB]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 5 },
  labels: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  pctA: { color: COLORS.accent, fontSize: 14, fontWeight: FONTS.heavy },
  pctB: { color: COLORS.accent2, fontSize: 14, fontWeight: FONTS.heavy },
  total: { color: COLORS.textMuted, fontSize: 11 },
  track: {
    flexDirection: "row",
    overflow: "hidden",
    backgroundColor: COLORS.surface,
  },
  fillA: { backgroundColor: COLORS.accent },
  fillB: { backgroundColor: COLORS.accent2 },
});
