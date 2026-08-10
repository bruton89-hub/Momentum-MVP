import React, { memo, useCallback } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { COLORS, SPACING, RADIUS, FONTS, TYPE, HIT_SLOP } from "@/constants/theme";
import AvatarImage from "@/components/AvatarImage";
import MediaTile from "@/components/MediaTile";
import { getBattleWinner, getBattleEndTime } from "@/hooks/useBattles";
import type { Battle, BattlePlayer } from "@/types";

interface Props {
  battle: Battle;
  /** Opens the existing BattleDetailModal. */
  onOpen: (battle: Battle) => void;
  onOpenAthlete: (userId: string) => void;
  onShare: (battle: Battle) => void;
  /** When set, the card shows WON/LOST from this viewer's perspective. */
  viewerUserId?: string | null;
}

/** "Aug 9" / "Aug 9, 2025" — from the battle's stored end time. */
function formatEnded(battle: Battle): string {
  const ms = getBattleEndTime(battle);
  if (!ms) return "";
  const date = new Date(ms);
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/**
 * Compact, score-first result card.
 *
 * Replaces the full-screen archive card: one row of media thumbs, both
 * athletes, the final split, and the actions. Only the thumbnails load media,
 * so a long Completed list doesn't mount full-size players.
 *
 * Winner comes from `getBattleWinner`, which prefers the server-written
 * `winner` field and only falls back to stored vote counts.
 */
function BattleResultCard({
  battle,
  onOpen,
  onOpenAthlete,
  onShare,
  viewerUserId,
}: Props) {
  const votesA = Math.max(0, battle.votesA ?? 0);
  const votesB = Math.max(0, battle.votesB ?? 0);
  const total = votesA + votesB;
  const percentA = total > 0 ? Math.round((votesA / total) * 100) : null;
  const percentB = percentA === null ? null : 100 - percentA;

  const outcome = getBattleWinner(battle);
  const isTie = outcome === "tie";
  const winner = !isTie && outcome ? (outcome as BattlePlayer) : null;
  const winnerIsA = !!winner && winner.userId === battle.playerA?.userId;

  const nameA = battle.playerA?.username?.trim() || "Athlete";
  const nameB = battle.playerB?.username?.trim() || "Athlete";
  const category = battle.category?.trim();
  const ended = formatEnded(battle);

  // Viewer-relative outcome, only when the viewer actually competed.
  const viewerCompeted =
    !!viewerUserId &&
    (battle.playerA?.userId === viewerUserId ||
      battle.playerB?.userId === viewerUserId);
  const viewerWon = viewerCompeted && !!winner && winner.userId === viewerUserId;
  const viewerLost = viewerCompeted && !!winner && winner.userId !== viewerUserId;

  const open = useCallback(() => onOpen(battle), [battle, onOpen]);
  const share = useCallback(() => onShare(battle), [battle, onShare]);
  const openA = useCallback(() => {
    if (battle.playerA?.userId) onOpenAthlete(battle.playerA.userId);
  }, [battle.playerA?.userId, onOpenAthlete]);
  const openB = useCallback(() => {
    if (battle.playerB?.userId) onOpenAthlete(battle.playerB.userId);
  }, [battle.playerB?.userId, onOpenAthlete]);

  return (
    <View style={styles.card}>
      {/* Status strip */}
      <View style={styles.topRow}>
        <View style={styles.statusGroup}>
          <View
            style={[
              styles.statusChip,
              viewerWon && styles.statusWon,
              viewerLost && styles.statusLost,
            ]}
          >
            <Text
              style={[
                styles.statusText,
                viewerWon && styles.statusTextWon,
                viewerLost && styles.statusTextLost,
              ]}
            >
              {viewerWon ? "WON" : viewerLost ? "LOST" : "FINAL"}
            </Text>
          </View>
          {!!category && <Text style={styles.category}>{category}</Text>}
        </View>
        {!!ended && <Text style={styles.ended}>{ended}</Text>}
      </View>

      {/* Matchup row */}
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={
          `${nameA} versus ${nameB}. ` +
          (isTie
            ? "Tie."
            : winner
            ? `${winner.username?.trim() || "Winner"} won.`
            : "") +
          (total > 0 ? ` ${percentA} to ${percentB} percent from ${total} votes.` : "") +
          " Open the battle."
        }
        style={({ pressed }) => [styles.matchup, pressed && styles.pressed]}
      >
        <View style={[styles.thumb, winner && winnerIsA && styles.thumbWinner]}>
          {battle.playerA?.mediaUrl ? (
            <MediaTile
              uri={battle.playerA.mediaUrl}
              mediaType={battle.playerA.mediaType}
              style={StyleSheet.absoluteFillObject}
              context="BattleResult"
            />
          ) : (
            <View style={styles.thumbEmpty} />
          )}
          {winner && winnerIsA && (
            <View style={styles.crown} pointerEvents="none">
              <MaterialCommunityIcons name="trophy" size={11} color={COLORS.black} />
            </View>
          )}
        </View>

        <View style={styles.scoreCol}>
          <Text style={styles.scoreLine}>
            <Text style={[styles.scoreA, winner && winnerIsA && styles.scoreWin]}>
              {percentA === null ? "—" : `${percentA}%`}
            </Text>
            <Text style={styles.scoreVs}>  vs  </Text>
            <Text style={[styles.scoreB, winner && !winnerIsA && styles.scoreWin]}>
              {percentB === null ? "—" : `${percentB}%`}
            </Text>
          </Text>
          <Text style={styles.totalVotes}>
            {total > 0
              ? `${total} ${total === 1 ? "vote" : "votes"}`
              : "No votes cast"}
          </Text>
          {isTie && <Text style={styles.tieLabel}>TIE</Text>}
        </View>

        <View style={[styles.thumb, winner && !winnerIsA && styles.thumbWinner]}>
          {battle.playerB?.mediaUrl ? (
            <MediaTile
              uri={battle.playerB.mediaUrl}
              mediaType={battle.playerB.mediaType}
              style={StyleSheet.absoluteFillObject}
              context="BattleResult"
            />
          ) : (
            <View style={styles.thumbEmpty} />
          )}
          {winner && !winnerIsA && (
            <View style={styles.crown} pointerEvents="none">
              <MaterialCommunityIcons name="trophy" size={11} color={COLORS.black} />
            </View>
          )}
        </View>
      </Pressable>

      {/* Athlete names — each opens a real profile */}
      <View style={styles.nameRow}>
        <Pressable
          onPress={openA}
          disabled={!battle.playerA?.userId}
          accessibilityRole="button"
          accessibilityLabel={`Open ${nameA}'s profile`}
          style={({ pressed }) => [styles.nameBtn, pressed && styles.pressed]}
        >
          <AvatarImage uri={battle.playerA?.avatar} username={nameA} size={22} />
          <Text style={styles.nameText} numberOfLines={1}>
            {nameA}
          </Text>
        </Pressable>
        <Pressable
          onPress={openB}
          disabled={!battle.playerB?.userId}
          accessibilityRole="button"
          accessibilityLabel={`Open ${nameB}'s profile`}
          style={({ pressed }) => [
            styles.nameBtn,
            styles.nameBtnRight,
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.nameText, styles.nameTextRight]} numberOfLines={1}>
            {nameB}
          </Text>
          <AvatarImage uri={battle.playerB?.avatar} username={nameB} size={22} />
        </Pressable>
      </View>

      {/* Actions. No Rematch button: Momentum has no rematch flow, and a
          control that can't complete is worse than its absence. */}
      <View style={styles.actions}>
        <Pressable
          onPress={open}
          accessibilityRole="button"
          accessibilityLabel={`Watch highlights from ${nameA} versus ${nameB}`}
          style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}
        >
          <Feather name="play" size={13} color={COLORS.textPrimary} />
          <Text style={styles.actionText}>Watch Highlights</Text>
        </Pressable>
        <Pressable
          onPress={share}
          hitSlop={HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel="Share this result"
          style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}
        >
          <Feather name="send" size={13} color={COLORS.textPrimary} />
          <Text style={styles.actionText}>Share Result</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default memo(BattleResultCard);

const THUMB = 64;

const styles = StyleSheet.create({
  card: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.surfaceRaised,
    overflow: "hidden",
  },
  pressed: { opacity: 0.78 },

  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
  },
  statusGroup: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  statusChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.xs,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  statusWon: {
    backgroundColor: COLORS.accentFaint,
    borderColor: COLORS.accentBorderFaint,
  },
  statusLost: { backgroundColor: COLORS.surface, borderColor: COLORS.cardBorder },
  statusText: {
    color: COLORS.textSecondary,
    fontSize: TYPE.micro,
    fontWeight: FONTS.heavy,
    letterSpacing: 0.6,
  },
  statusTextWon: { color: COLORS.accent },
  statusTextLost: { color: COLORS.textMuted },
  category: { color: COLORS.textMuted, fontSize: TYPE.micro },
  ended: { color: COLORS.textMuted, fontSize: TYPE.micro },

  matchup: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: RADIUS.md,
    overflow: "hidden",
    backgroundColor: COLORS.surfaceDeep,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  thumbWinner: { borderColor: COLORS.accent, borderWidth: 1.5 },
  thumbEmpty: { flex: 1, backgroundColor: COLORS.surfaceDeep },
  crown: {
    position: "absolute",
    top: 3,
    right: 3,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.accent,
  },

  scoreCol: { flex: 1, alignItems: "center", gap: 2 },
  scoreLine: { textAlign: "center" },
  scoreA: {
    color: COLORS.textSecondary,
    fontSize: TYPE.title3,
    fontWeight: FONTS.heavy,
  },
  scoreB: {
    color: COLORS.textSecondary,
    fontSize: TYPE.title3,
    fontWeight: FONTS.heavy,
  },
  scoreWin: { color: COLORS.accent },
  scoreVs: { color: COLORS.textMuted, fontSize: TYPE.caption, fontWeight: FONTS.bold },
  totalVotes: { color: COLORS.textMuted, fontSize: TYPE.micro },
  tieLabel: {
    color: COLORS.warning,
    fontSize: TYPE.micro,
    fontWeight: FONTS.heavy,
    letterSpacing: 0.5,
  },

  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
  },
  nameBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 34,
  },
  nameBtnRight: { justifyContent: "flex-end" },
  nameText: {
    color: COLORS.textSecondary,
    fontSize: TYPE.caption,
    fontWeight: FONTS.bold,
    flexShrink: 1,
  },
  nameTextRight: { textAlign: "right" },

  actions: {
    flexDirection: "row",
    gap: SPACING.sm,
    padding: SPACING.md,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 40,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.surface,
  },
  actionText: {
    color: COLORS.textPrimary,
    fontSize: TYPE.caption,
    fontWeight: FONTS.bold,
  },
});
