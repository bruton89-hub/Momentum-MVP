import React, { memo, useCallback } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { COLORS, SPACING, RADIUS, FONTS, TYPE } from "@/constants/theme";
import AvatarImage from "@/components/AvatarImage";
import MediaTile from "@/components/MediaTile";
import { getTimeRemainingLabel } from "@/hooks/useBattles";
import type { Battle } from "@/types";

interface Props {
  battle: Battle;
  /** Runs the existing AcceptModal flow (media pick + acceptChallenge). */
  onAccept: (battleId: string) => void;
  onOpen: (battle: Battle) => void;
  onOpenAthlete: (userId: string) => void;
  /** False for the challenge's own creator — they can't accept themselves. */
  canAccept: boolean;
}

/**
 * An unmatched open challenge waiting for an opponent.
 *
 * Only battles that `getBattleStatus` reports as "open" reach this row, so an
 * expired unmatched challenge can never appear here.
 */
function OpenChallengeRow({
  battle,
  onAccept,
  onOpen,
  onOpenAthlete,
  canAccept,
}: Props) {
  const creator = battle.playerA;
  const name = creator?.username?.trim() || "Athlete";
  const category = battle.category?.trim() || "Highlights";
  const remaining = getTimeRemainingLabel(battle);

  const accept = useCallback(() => onAccept(battle.id), [battle.id, onAccept]);
  const open = useCallback(() => onOpen(battle), [battle, onOpen]);
  const openAthlete = useCallback(() => {
    if (creator?.userId) onOpenAthlete(creator.userId);
  }, [creator?.userId, onOpenAthlete]);

  return (
    <View style={styles.row}>
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={`Open ${name}'s ${category} challenge`}
        style={({ pressed }) => [styles.thumb, pressed && styles.pressed]}
      >
        {creator?.mediaUrl ? (
          <MediaTile
            uri={creator.mediaUrl}
            mediaType={creator.mediaType}
            style={StyleSheet.absoluteFillObject}
            context="OpenChallenge"
          />
        ) : (
          <View style={styles.thumbEmpty}>
            <Feather name="image" size={16} color={COLORS.textMuted} />
          </View>
        )}
      </Pressable>

      <View style={styles.body}>
        <Pressable
          onPress={openAthlete}
          disabled={!creator?.userId}
          accessibilityRole="button"
          accessibilityLabel={`Open ${name}'s profile`}
          style={({ pressed }) => [styles.identity, pressed && styles.pressed]}
        >
          <AvatarImage uri={creator?.avatar} username={name} size={26} />
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
        </Pressable>
        <Text style={styles.meta} numberOfLines={1}>
          {category}
          {remaining && remaining !== "Ended" ? ` · ${remaining}` : ""}
        </Text>
      </View>

      {canAccept ? (
        <Pressable
          onPress={accept}
          accessibilityRole="button"
          accessibilityLabel={`Accept ${name}'s challenge`}
          style={({ pressed }) => [styles.acceptBtn, pressed && styles.pressed]}
        >
          <Text style={styles.acceptText}>ACCEPT</Text>
        </Pressable>
      ) : (
        // The creator can't accept their own challenge (enforced in
        // firestore.rules). Shown as a disabled state with the reason rather
        // than a button that would always fail.
        <View
          style={styles.yoursBadge}
          accessible
          accessibilityLabel="Your own challenge — waiting for an opponent"
        >
          <Text style={styles.yoursText}>YOURS</Text>
        </View>
      )}
    </View>
  );
}

export default memo(OpenChallengeRow);

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    minHeight: 72,
  },
  pressed: { opacity: 0.75 },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: RADIUS.md,
    overflow: "hidden",
    backgroundColor: COLORS.surfaceDeep,
  },
  thumbEmpty: { flex: 1, alignItems: "center", justifyContent: "center" },
  body: { flex: 1, gap: 2 },
  identity: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  name: {
    color: COLORS.textPrimary,
    fontSize: TYPE.footnote,
    fontWeight: FONTS.bold,
    flexShrink: 1,
  },
  meta: { color: COLORS.textMuted, fontSize: TYPE.micro },
  acceptBtn: {
    minWidth: 82,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.accent,
  },
  acceptText: {
    color: COLORS.black,
    fontSize: TYPE.micro,
    fontWeight: FONTS.heavy,
    letterSpacing: 0.5,
  },
  yoursBadge: {
    minWidth: 82,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.surface,
  },
  yoursText: {
    color: COLORS.textMuted,
    fontSize: TYPE.micro,
    fontWeight: FONTS.heavy,
    letterSpacing: 0.5,
  },
});
