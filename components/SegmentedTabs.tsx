import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { COLORS, SPACING, FONTS, TYPE } from "@/constants/theme";

export interface TabDef<K extends string> {
  key: K;
  label: string;
}

interface Props<K extends string> {
  tabs: readonly TabDef<K>[];
  activeKey: K;
  onChange: (key: K) => void;
  /** true (default): tabs share width equally. false: tabs hug their labels. */
  distribute?: boolean;
}

/**
 * Underline tab row — the single tab pattern used by the Home feed,
 * Battles screen, and both profile screens (previously four separate
 * hand-rolled implementations with drifting underline heights).
 */
export default function SegmentedTabs<K extends string>({
  tabs,
  activeKey,
  onChange,
  distribute = true,
}: Props<K>) {
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {tabs.map((tab) => {
        const isActive = tab.key === activeKey;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: isActive }}
            style={({ pressed }) => [
              styles.tab,
              distribute && styles.tabDistributed,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.label, isActive && styles.labelActive]}>
              {tab.label}
            </Text>
            <View style={[styles.underline, isActive && styles.underlineActive]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
  },
  tab: {
    alignItems: "center",
    paddingTop: SPACING.sm + 2,
    paddingHorizontal: SPACING.lg,
  },
  tabDistributed: {
    flex: 1,
    paddingHorizontal: SPACING.sm,
  },
  pressed: { opacity: 0.7 },
  label: {
    color: COLORS.textMuted,
    fontSize: TYPE.body,
    fontWeight: FONTS.semibold,
    letterSpacing: 0.3,
  },
  labelActive: {
    color: COLORS.textPrimary,
    fontWeight: FONTS.bold,
  },
  underline: {
    width: "100%",
    height: 3,
    borderRadius: 3,
    backgroundColor: COLORS.transparent,
    marginTop: SPACING.sm + 2,
  },
  underlineActive: {
    backgroundColor: COLORS.accent,
  },
});
