import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS } from "@/constants/theme";

export type SportBadgeVariant =
  | "live"
  | "winner"
  | "trending"
  | "verified"
  | "score"
  | "challenge"
  | "champion"
  | "topRanked"
  | "coach";

interface Props {
  variant: SportBadgeVariant;
  /** Extra text — e.g. the Momentum Score value. */
  value?: string | number;
}

/**
 * Broadcast-style status badges — LIVE, Battle Winner, Trending, Verified
 * Athlete, Momentum Score, Challenge Available. Dark scrim pill + thin
 * colored border reads cleanly over full-screen video, ESPN-ticker style.
 */
export default function SportBadge({ variant, value }: Props) {
  const config = CONFIG[variant];
  const label = value !== undefined ? `${config.label} ${value}` : config.label;

  return (
    <View
      style={[
        styles.badge,
        { borderColor: config.border, backgroundColor: config.bg },
      ]}
      accessible
      accessibilityLabel={label}
    >
      {variant === "live" && <View style={styles.liveDot} />}
      {config.icon}
      <Text style={[styles.text, { color: config.color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADIUS.xs,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  text: {
    fontSize: 10,
    fontWeight: FONTS.extrabold,
    letterSpacing: 0.8,
  },
  emoji: { fontSize: 10 },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.white,
  },
});

const CONFIG: Record<
  SportBadgeVariant,
  {
    label: string;
    color: string;
    border: string;
    bg: string;
    icon: React.ReactNode;
  }
> = {
  live: {
    label: "LIVE",
    color: COLORS.white,
    border: COLORS.live,
    bg: "rgba(255,68,68,0.85)",
    icon: null,
  },
  winner: {
    label: "BATTLE WINNER",
    color: COLORS.warning,
    border: COLORS.warningBorder,
    bg: COLORS.scrimBadge,
    icon: (
      <MaterialCommunityIcons name="trophy" size={11} color={COLORS.warning} />
    ),
  },
  trending: {
    label: "TRENDING",
    color: COLORS.white,
    border: "rgba(255,255,255,0.35)",
    bg: COLORS.scrimBadge,
    icon: <Text style={styles.emoji}>🔥</Text>,
  },
  verified: {
    label: "VERIFIED ATHLETE",
    color: COLORS.accent,
    border: COLORS.accentBorderFaint,
    bg: COLORS.scrimBadge,
    icon: (
      <MaterialCommunityIcons
        name="check-decagram"
        size={11}
        color={COLORS.accent}
      />
    ),
  },
  score: {
    label: "MOMENTUM",
    color: COLORS.accent,
    border: COLORS.accentBorderFaint,
    bg: COLORS.scrimBadge,
    icon: <Feather name="zap" size={11} color={COLORS.accent} />,
  },
  challenge: {
    label: "OPEN FOR CHALLENGE",
    color: COLORS.accent,
    border: COLORS.accentBorderFaint,
    bg: COLORS.scrimBadge,
    icon: (
      <MaterialCommunityIcons
        name="sword-cross"
        size={11}
        color={COLORS.accent}
      />
    ),
  },
  champion: {
    label: "TOURNAMENT CHAMPION",
    color: COLORS.warning,
    border: COLORS.warningBorder,
    bg: COLORS.scrimBadge,
    icon: (
      <MaterialCommunityIcons name="medal" size={11} color={COLORS.warning} />
    ),
  },
  topRanked: {
    label: "TOP RANKED",
    color: COLORS.white,
    border: "rgba(255,255,255,0.35)",
    bg: COLORS.scrimBadge,
    icon: <Feather name="trending-up" size={11} color={COLORS.white} />,
  },
  coach: {
    label: "COACH VERIFIED",
    color: COLORS.accent2,
    border: "rgba(79,195,247,0.45)",
    bg: COLORS.scrimBadge,
    icon: (
      <MaterialCommunityIcons name="whistle" size={11} color={COLORS.accent2} />
    ),
  },
};
