import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS } from "@/constants/theme";

/**
 * Derived battle status values that exist in this codebase.
 * Stored Firestore statuses are "open" | "live" | "completed";
 * getBattleStatus() additionally folds expiry into "completed".
 * Anything else renders through the "unknown" fallback — neutral and safe.
 */
export type BattleStatusValue = "open" | "live" | "completed" | (string & {});

interface Props {
  status: BattleStatusValue;
  /** Compact = smaller padding for tight rows. */
  compact?: boolean;
}

interface StatusConfig {
  label: string;
  color: string;
  bg: string;
  border: string;
  icon: React.ReactNode;
  a11y: string;
}

function configFor(status: BattleStatusValue): StatusConfig {
  switch (status) {
    case "live":
      return {
        label: "LIVE",
        color: COLORS.live,
        bg: COLORS.liveFaint,
        border: COLORS.live,
        icon: <View style={styles.liveDot} />,
        a11y: "Live battle — voting open",
      };
    case "completed":
      return {
        label: "COMPLETED",
        color: COLORS.warning,
        bg: COLORS.warningFaint,
        border: COLORS.warningBorder,
        icon: (
          <MaterialCommunityIcons name="trophy-outline" size={11} color={COLORS.warning} />
        ),
        a11y: "Battle completed",
      };
    case "open":
      return {
        label: "OPEN CHALLENGE",
        color: COLORS.textSecondary,
        bg: COLORS.surface,
        border: COLORS.inputBorder,
        icon: <Feather name="clock" size={11} color={COLORS.textSecondary} />,
        a11y: "Open challenge — waiting for an opponent",
      };
    default:
      // Unknown status from a newer/older app version — render neutrally,
      // never reinterpret.
      return {
        label: String(status).toUpperCase() || "BATTLE",
        color: COLORS.textSecondary,
        bg: COLORS.surface,
        border: COLORS.inputBorder,
        icon: <Feather name="info" size={11} color={COLORS.textSecondary} />,
        a11y: `Battle status: ${status}`,
      };
  }
}

/**
 * The single battle-status treatment used across cards, rows, and the detail
 * sheet. Icon + text + color together (color is never the only indicator).
 */
export default function BattleStatusBadge({ status, compact = false }: Props) {
  const config = configFor(status);
  return (
    <View
      style={[
        styles.badge,
        compact && styles.badgeCompact,
        { backgroundColor: config.bg, borderColor: config.border },
      ]}
      accessible
      accessibilityLabel={config.a11y}
    >
      {config.icon}
      <Text style={[styles.text, { color: config.color }]}>{config.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    borderRadius: RADIUS.xs,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeCompact: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  text: {
    fontSize: 10,
    fontWeight: FONTS.extrabold,
    letterSpacing: 0.8,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.live,
  },
});
