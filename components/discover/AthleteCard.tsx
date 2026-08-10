import React, { memo, useCallback } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { COLORS, SPACING, RADIUS, FONTS, TYPE } from "@/constants/theme";
import AvatarImage from "@/components/AvatarImage";
import type { DiscoverAthlete } from "@/services/discoverRepository";

export type AthleteCardMetric =
  /** "3 new" — real count of the athlete's posts inside the Rising window. */
  | "recentPosts"
  /** "12W · 4L" — stored battle record. */
  | "record"
  /** Identity only. Used where no honest metric exists. */
  | "none";

interface Props {
  athlete: DiscoverAthlete;
  onPress: (userId: string) => void;
  metric?: AthleteCardMetric;
  /** Stored wins/losses, only supplied by the Top Records rail. */
  wins?: number;
  losses?: number;
  verified?: boolean;
}

/**
 * Horizontal-rail athlete card.
 *
 * The metric slot renders only values Momentum actually stores or counts. There
 * is deliberately no follower count, view count, or trending score here —
 * none of those exist in the data model, and inventing one would make the whole
 * page untrustworthy.
 */
function AthleteCard({
  athlete,
  onPress,
  metric = "none",
  wins,
  losses,
  verified,
}: Props) {
  const handlePress = useCallback(
    () => onPress(athlete.userId),
    [athlete.userId, onPress]
  );

  const detail = [athlete.sport, athlete.position].filter(Boolean).join(" · ");
  const hasRecord =
    metric === "record" && ((wins ?? 0) > 0 || (losses ?? 0) > 0);
  const showRecentPosts = metric === "recentPosts" && athlete.postCount > 0;

  const metricLabel = showRecentPosts
    ? `${athlete.postCount} new ${athlete.postCount === 1 ? "highlight" : "highlights"}`
    : hasRecord
    ? `${wins} wins, ${losses} losses`
    : "";

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`${athlete.username}${detail ? `, ${detail}` : ""}${
        metricLabel ? `, ${metricLabel}` : ""
      }. Open profile.`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.avatarWrap}>
        <AvatarImage
          uri={athlete.avatarUrl}
          username={athlete.username}
          size={62}
        />
        {verified && (
          <View style={styles.verifiedDot}>
            <MaterialCommunityIcons
              name="check-decagram"
              size={14}
              color={COLORS.accent}
            />
          </View>
        )}
      </View>

      <Text style={styles.name} numberOfLines={1}>
        {athlete.username}
      </Text>

      {!!detail && (
        <Text style={styles.detail} numberOfLines={1}>
          {detail}
        </Text>
      )}

      {showRecentPosts ? (
        <View style={styles.metricPill}>
          <Feather name="trending-up" size={10} color={COLORS.accent} />
          <Text style={styles.metricText}>
            {athlete.postCount} new
          </Text>
        </View>
      ) : hasRecord ? (
        <View style={styles.metricPillMuted}>
          <MaterialCommunityIcons
            name="trophy-outline"
            size={10}
            color={COLORS.textSecondary}
          />
          <Text style={styles.metricTextMuted}>
            {wins}W · {losses}L
          </Text>
        </View>
      ) : athlete.school ? (
        <Text style={styles.school} numberOfLines={1}>
          {athlete.school}
        </Text>
      ) : null}
    </Pressable>
  );
}

export default memo(AthleteCard);

const styles = StyleSheet.create({
  card: {
    width: 128,
    alignItems: "center",
    gap: 4,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.surfaceRaised,
  },
  pressed: { opacity: 0.75 },
  avatarWrap: { marginBottom: 4 },
  verifiedDot: {
    position: "absolute",
    right: -2,
    bottom: -2,
    borderRadius: 999,
    backgroundColor: COLORS.background,
  },
  name: {
    color: COLORS.textPrimary,
    fontSize: TYPE.footnote,
    fontWeight: FONTS.bold,
    maxWidth: "100%",
  },
  detail: {
    color: COLORS.textMuted,
    fontSize: TYPE.micro,
    maxWidth: "100%",
  },
  school: {
    color: COLORS.textMuted,
    fontSize: TYPE.micro,
    marginTop: 2,
    maxWidth: "100%",
  },
  metricPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: COLORS.accentFaint,
    borderWidth: 1,
    borderColor: COLORS.accentBorderFaint,
  },
  metricText: {
    color: COLORS.accent,
    fontSize: TYPE.micro,
    fontWeight: FONTS.heavy,
  },
  metricPillMuted: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  metricTextMuted: {
    color: COLORS.textSecondary,
    fontSize: TYPE.micro,
    fontWeight: FONTS.bold,
  },
});
