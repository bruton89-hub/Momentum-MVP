import React, { memo, useCallback } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { COLORS, SPACING, RADIUS, FONTS, TYPE } from "@/constants/theme";
import AvatarImage from "@/components/AvatarImage";
import MediaTile from "@/components/MediaTile";
import { getTimeRemainingLabel } from "@/hooks/useBattles";
import { voteSplit } from "@/services/discoverRepository";
import type { Battle } from "@/types";

interface Props {
  battle: Battle;
  /** Opens the existing BattleDetailModal — the same voting experience the
   *  Battles tab uses. Both the card body and Vote Now route here. */
  onOpen: (battle: Battle) => void;
  onOpenAthlete: (userId: string) => void;
  /** Existing vote, so a card the viewer already voted on says so. */
  userVote: "A" | "B" | null;
}

/**
 * Live battle card for the Discover rail.
 *
 * Vote counts and percentages come straight from the battle document's
 * votesA/votesB, which only the castBattleVote callable can write. When nobody
 * has voted the card says so rather than rendering a fake 50/50 split.
 */
function HotBattleCard({ battle, onOpen, onOpenAthlete, userVote }: Props) {
  const { total, percentA, percentB } = voteSplit(battle);
  const remaining = getTimeRemainingLabel(battle);

  const open = useCallback(() => onOpen(battle), [battle, onOpen]);
  const openA = useCallback(
    () => battle.playerA?.userId && onOpenAthlete(battle.playerA.userId),
    [battle.playerA?.userId, onOpenAthlete]
  );
  const openB = useCallback(
    () => battle.playerB?.userId && onOpenAthlete(battle.playerB.userId),
    [battle.playerB?.userId, onOpenAthlete]
  );

  const nameA = battle.playerA?.username || "Athlete";
  const nameB = battle.playerB?.username || "Athlete";

  return (
    <View style={styles.card}>
      {/* Card body opens the battle. Nested athlete taps are separate siblings
          below the media so no pressable is nested inside another. */}
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={
          `Live battle: ${nameA} versus ${nameB}. ` +
          (total > 0
            ? `${percentA} percent to ${percentB} percent from ${total} votes.`
            : "No votes yet.") +
          " Open to vote."
        }
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
      >
        <View style={styles.mediaRow}>
          <View style={styles.mediaHalf}>
            {battle.playerA?.mediaUrl ? (
              <MediaTile
                uri={battle.playerA.mediaUrl}
                mediaType={battle.playerA.mediaType}
                style={StyleSheet.absoluteFillObject}
                context="DiscoverBattle"
              />
            ) : (
              <View style={styles.mediaFallback} />
            )}
          </View>
          <View style={styles.vsBadge} pointerEvents="none">
            <Text style={styles.vsText}>VS</Text>
          </View>
          <View style={styles.mediaHalf}>
            {battle.playerB?.mediaUrl ? (
              <MediaTile
                uri={battle.playerB.mediaUrl}
                mediaType={battle.playerB.mediaType}
                style={StyleSheet.absoluteFillObject}
                context="DiscoverBattle"
              />
            ) : (
              <View style={styles.mediaFallback} />
            )}
          </View>

          <View style={styles.statusBadge} pointerEvents="none">
            <View style={styles.liveDot} />
            <Text style={styles.statusText}>LIVE</Text>
          </View>
          {!!remaining && (
            <View style={styles.timeBadge} pointerEvents="none">
              <Feather name="clock" size={9} color={COLORS.white} />
              <Text style={styles.timeText}>{remaining}</Text>
            </View>
          )}
        </View>

        {/* Vote split — real counts only */}
        <View style={styles.splitWrap}>
          {total > 0 ? (
            <>
              <View style={styles.splitBar}>
                <View style={[styles.splitFillA, { flex: percentA ?? 50 }]} />
                <View style={[styles.splitFillB, { flex: percentB ?? 50 }]} />
              </View>
              <View style={styles.splitLabels}>
                <Text style={styles.splitPercentA}>{percentA}%</Text>
                <Text style={styles.splitTotal}>
                  {total} {total === 1 ? "vote" : "votes"}
                </Text>
                <Text style={styles.splitPercentB}>{percentB}%</Text>
              </View>
            </>
          ) : (
            <Text style={styles.noVotes}>No votes yet — be the first</Text>
          )}
        </View>
      </Pressable>

      {/* Athlete names open real profiles */}
      <View style={styles.nameRow}>
        <Pressable
          onPress={openA}
          accessibilityRole="button"
          accessibilityLabel={`Open ${nameA}'s profile`}
          style={({ pressed }) => [styles.nameBtn, pressed && styles.pressed]}
        >
          <AvatarImage
            uri={battle.playerA?.avatar}
            username={nameA}
            size={22}
          />
          <Text style={styles.nameText} numberOfLines={1}>
            {nameA}
          </Text>
        </Pressable>
        <Pressable
          onPress={openB}
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
          <AvatarImage
            uri={battle.playerB?.avatar}
            username={nameB}
            size={22}
          />
        </Pressable>
      </View>

      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={
          userVote ? "You voted — open this battle" : `Vote on ${nameA} versus ${nameB}`
        }
        style={({ pressed }) => [
          styles.voteBtn,
          userVote && styles.voteBtnVoted,
          pressed && styles.pressed,
        ]}
      >
        <Feather
          name={userVote ? "check-circle" : "zap"}
          size={14}
          color={userVote ? COLORS.accent : COLORS.black}
        />
        <Text style={[styles.voteText, userVote && styles.voteTextVoted]}>
          {userVote ? "Voted · View" : "Vote Now"}
        </Text>
      </Pressable>
    </View>
  );
}

export default memo(HotBattleCard);

const CARD_W = 264;
const MEDIA_H = 132;

const styles = StyleSheet.create({
  card: {
    width: CARD_W,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.surfaceRaised,
    overflow: "hidden",
  },
  body: { width: "100%" },
  pressed: { opacity: 0.8 },

  mediaRow: { flexDirection: "row", height: MEDIA_H, backgroundColor: COLORS.surfaceDeep },
  mediaHalf: { flex: 1, overflow: "hidden" },
  mediaFallback: { flex: 1, backgroundColor: COLORS.surfaceDeep },
  vsBadge: {
    position: "absolute",
    alignSelf: "center",
    top: MEDIA_H / 2 - 15,
    left: CARD_W / 2 - 15,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.scrimBadge,
    borderWidth: 1,
    borderColor: COLORS.accent,
    zIndex: 2,
  },
  vsText: {
    color: COLORS.accent,
    fontSize: 10,
    fontWeight: FONTS.heavy,
  },
  statusBadge: {
    position: "absolute",
    top: SPACING.sm,
    left: SPACING.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: RADIUS.xs,
    backgroundColor: COLORS.scrimBadge,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.live,
  },
  statusText: {
    color: COLORS.white,
    fontSize: TYPE.micro,
    fontWeight: FONTS.heavy,
    letterSpacing: 0.5,
  },
  timeBadge: {
    position: "absolute",
    top: SPACING.sm,
    right: SPACING.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: RADIUS.xs,
    backgroundColor: COLORS.scrimBadge,
  },
  timeText: { color: COLORS.white, fontSize: TYPE.micro, fontWeight: FONTS.bold },

  splitWrap: { paddingHorizontal: SPACING.md, paddingTop: SPACING.md, gap: 5 },
  splitBar: {
    flexDirection: "row",
    height: 5,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: COLORS.inputBorder,
  },
  splitFillA: { backgroundColor: COLORS.accent },
  splitFillB: { backgroundColor: COLORS.accent2 },
  splitLabels: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  splitPercentA: {
    color: COLORS.accent,
    fontSize: TYPE.micro,
    fontWeight: FONTS.heavy,
  },
  splitPercentB: {
    color: COLORS.accent2,
    fontSize: TYPE.micro,
    fontWeight: FONTS.heavy,
  },
  splitTotal: { color: COLORS.textMuted, fontSize: TYPE.micro },
  noVotes: {
    color: COLORS.textMuted,
    fontSize: TYPE.micro,
    textAlign: "center",
    paddingVertical: 2,
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
    gap: 5,
    minHeight: 32,
  },
  nameBtnRight: { justifyContent: "flex-end" },
  nameText: {
    color: COLORS.textSecondary,
    fontSize: TYPE.micro,
    fontWeight: FONTS.bold,
    flexShrink: 1,
  },
  nameTextRight: { textAlign: "right" },

  voteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 40,
    margin: SPACING.md,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.accent,
  },
  voteBtnVoted: {
    backgroundColor: COLORS.transparent,
    borderWidth: 1,
    borderColor: COLORS.accentBorderFaint,
  },
  voteText: {
    color: COLORS.black,
    fontSize: TYPE.footnote,
    fontWeight: FONTS.heavy,
  },
  voteTextVoted: { color: COLORS.accent },
});
