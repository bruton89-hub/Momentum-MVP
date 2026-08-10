import React, { memo, useCallback } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { COLORS, SPACING, RADIUS, FONTS, TYPE, HIT_SLOP } from "@/constants/theme";
import AvatarImage from "./AvatarImage";
import { toHandle } from "@/utils/format";
import type { UserProfile } from "@/types";

interface Props {
  athlete: UserProfile;
  onPress: (userId: string) => void;
  /** Omitted entirely when the viewer is signed out or it's their own row. */
  isFollowing?: boolean;
  onToggleFollow?: (userId: string, isCurrentlyFollowing: boolean) => void;
  /** "row" for search results, "card" for horizontal browse rails. */
  variant?: "row" | "card";
}

/** The identity line under a name — sport, position, school, all optional. */
function detailLine(athlete: UserProfile): string {
  return [
    athlete.sport || athlete.athleteType,
    athlete.position,
    athlete.school || athlete.teamName,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** One athlete, as a search result row or a browse card. */
function AthleteRow({
  athlete,
  onPress,
  isFollowing,
  onToggleFollow,
  variant = "row",
}: Props) {
  const handlePress = useCallback(
    () => onPress(athlete.userId),
    [athlete.userId, onPress]
  );
  const handleFollow = useCallback(
    () => onToggleFollow?.(athlete.userId, !!isFollowing),
    [athlete.userId, isFollowing, onToggleFollow]
  );

  const details = detailLine(athlete);
  const record =
    athlete.wins > 0 || athlete.losses > 0
      ? `${athlete.wins}W · ${athlete.losses}L`
      : null;

  if (variant === "card") {
    return (
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={`${athlete.username}${details ? `, ${details}` : ""}. Open profile.`}
        style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      >
        <AvatarImage uri={athlete.avatarUrl} username={athlete.username} size={64} />
        <View style={styles.cardText}>
          <View style={styles.nameRow}>
            <Text style={styles.cardName} numberOfLines={1}>
              {athlete.username}
            </Text>
            {athlete.verified && (
              <MaterialCommunityIcons
                name="check-decagram"
                size={13}
                color={COLORS.accent}
              />
            )}
          </View>
          {!!details && (
            <Text style={styles.cardDetail} numberOfLines={2}>
              {details}
            </Text>
          )}
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`${athlete.username}${details ? `, ${details}` : ""}. Open profile.`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <AvatarImage uri={athlete.avatarUrl} username={athlete.username} size={48} />

      <View style={styles.rowText}>
        <View style={styles.nameRow}>
          <Text style={styles.rowName} numberOfLines={1}>
            {athlete.username}
          </Text>
          {athlete.verified && (
            <MaterialCommunityIcons
              name="check-decagram"
              size={14}
              color={COLORS.accent}
            />
          )}
        </View>
        <Text style={styles.rowHandle} numberOfLines={1}>
          {toHandle(athlete.username)}
        </Text>
        {!!details && (
          <Text style={styles.rowDetail} numberOfLines={1}>
            {details}
          </Text>
        )}
      </View>

      {onToggleFollow ? (
        <Pressable
          onPress={handleFollow}
          hitSlop={HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel={
            isFollowing ? `Unfollow ${athlete.username}` : `Follow ${athlete.username}`
          }
          accessibilityState={{ selected: !!isFollowing }}
          style={({ pressed }) => [
            styles.followBtn,
            isFollowing && styles.followBtnActive,
            pressed && styles.pressed,
          ]}
        >
          <Text
            style={[styles.followText, isFollowing && styles.followTextActive]}
          >
            {isFollowing ? "Following" : "Follow"}
          </Text>
        </Pressable>
      ) : record ? (
        <Text style={styles.record}>{record}</Text>
      ) : null}
    </Pressable>
  );
}

export default memo(AthleteRow);

const styles = StyleSheet.create({
  pressed: { opacity: 0.75 },

  // ── Search result row ──────────────────────────────────────────────────────
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    minHeight: 72,
  },
  rowText: { flex: 1, gap: 1 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  rowName: {
    color: COLORS.textPrimary,
    fontSize: TYPE.callout,
    fontWeight: FONTS.bold,
    flexShrink: 1,
  },
  rowHandle: {
    color: COLORS.textHandle,
    fontSize: TYPE.small,
  },
  rowDetail: {
    color: COLORS.textSecondary,
    fontSize: TYPE.small,
    marginTop: 1,
  },
  record: {
    color: COLORS.textMuted,
    fontSize: TYPE.caption,
    fontWeight: FONTS.bold,
  },
  followBtn: {
    minWidth: 88,
    minHeight: 34,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.accent,
  },
  followBtnActive: {
    backgroundColor: COLORS.transparent,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  followText: {
    color: COLORS.black,
    fontSize: TYPE.caption,
    fontWeight: FONTS.heavy,
  },
  followTextActive: { color: COLORS.textSecondary },

  // ── Browse card ────────────────────────────────────────────────────────────
  card: {
    width: 132,
    alignItems: "center",
    gap: SPACING.sm,
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.surfaceRaised,
  },
  cardText: { alignItems: "center", gap: 2 },
  cardName: {
    color: COLORS.textPrimary,
    fontSize: TYPE.footnote,
    fontWeight: FONTS.bold,
    flexShrink: 1,
  },
  cardDetail: {
    color: COLORS.textMuted,
    fontSize: TYPE.micro,
    textAlign: "center",
    lineHeight: 14,
  },
});
