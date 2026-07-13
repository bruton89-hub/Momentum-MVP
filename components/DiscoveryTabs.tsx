import React from "react";
import { ScrollView, Text, StyleSheet } from "react-native";
import { COLORS, FONTS, RADIUS, SPACING, TYPE } from "@/constants/theme";
import PressableScale from "./PressableScale";

export interface DiscoveryTabDef<K extends string> {
  key: K;
  label: string;
  emoji?: string;
}

interface Props<K extends string> {
  tabs: readonly DiscoveryTabDef<K>[];
  activeKey: K;
  onChange: (key: K) => void;
}

/**
 * Horizontally scrolling discovery pills for the feed header — 🔥 For You,
 * ⚔️ Battles, per-sport filters. Active pill fills Momentum green; inactive
 * pills are translucent scrims so video stays visible behind them.
 */
export default function DiscoveryTabs<K extends string>({
  tabs,
  activeKey,
  onChange,
}: Props<K>) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      accessibilityRole="tablist"
    >
      {tabs.map((tab) => {
        const isActive = tab.key === activeKey;
        return (
          <PressableScale
            key={tab.key}
            scaleTo={0.93}
            hitSlop={{ top: 6, bottom: 6 }}
            onPress={() => onChange(tab.key)}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: isActive }}
            style={[styles.pill, isActive && styles.pillActive]}
          >
            {tab.emoji ? (
              <Text style={styles.emoji}>{tab.emoji}</Text>
            ) : null}
            <Text style={[styles.label, isActive && styles.labelActive]}>
              {tab.label}
            </Text>
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.xs,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: SPACING.md,
    paddingVertical: 7,
    borderRadius: RADIUS.full,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  pillActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  emoji: { fontSize: 13 },
  label: {
    color: COLORS.textPrimary,
    fontSize: TYPE.footnote,
    fontWeight: FONTS.semibold,
    letterSpacing: 0.2,
  },
  labelActive: {
    color: COLORS.black,
    fontWeight: FONTS.extrabold,
  },
});
