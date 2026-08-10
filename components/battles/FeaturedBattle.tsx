import React, { memo, useCallback } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import Animated, { FadeIn, useReducedMotion } from "react-native-reanimated";
import {
  COLORS,
  SPACING,
  RADIUS,
  FONTS,
  TYPE,
  GLOW,
  HIT_SLOP,
} from "@/constants/theme";
import AvatarImage from "@/components/AvatarImage";
import MediaTile from "@/components/MediaTile";
import { getTimeRemainingLabel } from "@/hooks/useBattles";
import { toHandle } from "@/utils/format";
import type { Battle, BattlePlayer } from "@/types";

interface Props {
  battle: Battle;
  /** Existing vote from votedMap — drives the voted state and blocks re-votes. */
  userVote: "A" | "B" | null;
  /** True when the existing rules allow this viewer to vote right now. */
  canVote: boolean;
  /** The app's single vote path (handleVoteWithAdvance). */
  onVote: (battleId: string, side: "A" | "B") => void;
  /** Opens the full BattleDetailModal — the existing battle experience. */
  onOpen: (battle: Battle) => void;
  onOpenAthlete: (userId: string) => void;
  onShare: (battle: Battle) => void;
  /** Only rendered when another votable battle actually exists. */
  onSkip?: () => void;
}

/** One side of the matchup: media, avatar, identity, percentage. */
function Side({
  player,
  side,
  percent,
  votes,
  isVoted,
  canVote,
  onVote,
  onOpenMedia,
  onOpenAthlete,
}: {
  player: BattlePlayer | null;
  side: "A" | "B";
  percent: number | null;
  votes: number;
  isVoted: boolean;
  canVote: boolean;
  onVote: (side: "A" | "B") => void;
  onOpenMedia: () => void;
  onOpenAthlete: (userId: string) => void;
}) {
  const name = player?.username?.trim() || "Athlete";
  const accent = side === "A" ? COLORS.accent : COLORS.accent2;

  const handleAthlete = useCallback(() => {
    if (player?.userId) onOpenAthlete(player.userId);
  }, [player?.userId, onOpenAthlete]);

  return (
    <View style={styles.side}>
      {/* Media — opens the full battle view, which owns playback */}
      <Pressable
        onPress={onOpenMedia}
        accessibilityRole="button"
        accessibilityLabel={`${name}'s highlight. Open the battle to watch.`}
        style={({ pressed }) => [styles.media, pressed && styles.pressed]}
      >
        {player?.mediaUrl ? (
          <MediaTile
            uri={player.mediaUrl}
            mediaType={player.mediaType}
            style={StyleSheet.absoluteFillObject}
            context="FeaturedBattle"
          />
        ) : (
          <View style={styles.mediaEmpty}>
            <Feather name="video-off" size={20} color={COLORS.textMuted} />
          </View>
        )}
        {isVoted && (
          <View style={[styles.votedBadge, { borderColor: accent }]} pointerEvents="none">
            <Feather name="check" size={14} color={accent} />
          </View>
        )}
      </Pressable>

      {/* Identity — opens the athlete's real profile */}
      <Pressable
        onPress={handleAthlete}
        disabled={!player?.userId}
        accessibilityRole="button"
        accessibilityLabel={`Open ${name}'s profile`}
        style={({ pressed }) => [styles.identity, pressed && styles.pressed]}
      >
        <AvatarImage uri={player?.avatar} username={name} size={34} />
        <View style={styles.identityText}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.handle} numberOfLines={1}>
            {toHandle(name)}
          </Text>
        </View>
      </Pressable>

      {/* Percentage — only when real votes exist */}
      {percent !== null ? (
        <Text style={[styles.percent, { color: accent }]}>{percent}%</Text>
      ) : (
        <Text style={styles.percentEmpty}>—</Text>
      )}
      <Text style={styles.voteCount}>
        {votes} {votes === 1 ? "vote" : "votes"}
      </Text>

      {/* Vote control */}
      <Pressable
        onPress={() => onVote(side)}
        disabled={!canVote}
        accessibilityRole="button"
        accessibilityLabel={
          isVoted
            ? `You voted for ${name}`
            : canVote
            ? `Vote for ${name}`
            : `Voting closed for ${name}`
        }
        accessibilityState={{ disabled: !canVote, selected: isVoted }}
        style={({ pressed }) => [
          styles.voteBtn,
          side === "A" ? styles.voteBtnA : styles.voteBtnB,
          isVoted && styles.voteBtnVoted,
          !canVote && !isVoted && styles.voteBtnDisabled,
          pressed && canVote && styles.pressed,
        ]}
      >
        <Text
          style={[
            styles.voteBtnText,
            isVoted && { color: accent },
            !canVote && !isVoted && styles.voteBtnTextDisabled,
          ]}
          numberOfLines={1}
        >
          {isVoted ? "VOTED" : `VOTE ${name.toUpperCase()}`}
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * The Live tab's hero: full side-by-side matchup with the vote controls
 * inline, so Watch → Vote → See result happens without leaving the screen.
 *
 * Voting calls straight through to the app's existing vote handler; this
 * component holds no vote state of its own and renders whatever the shared
 * battle/votedMap state says.
 */
function FeaturedBattle({
  battle,
  userVote,
  canVote,
  onVote,
  onOpen,
  onOpenAthlete,
  onShare,
  onSkip,
}: Props) {
  const reducedMotion = useReducedMotion();

  const votesA = Math.max(0, battle.votesA ?? 0);
  const votesB = Math.max(0, battle.votesB ?? 0);
  const total = votesA + votesB;
  const percentA = total > 0 ? Math.round((votesA / total) * 100) : null;
  const percentB = percentA === null ? null : 100 - percentA;
  const remaining = getTimeRemainingLabel(battle);

  const open = useCallback(() => onOpen(battle), [battle, onOpen]);
  const share = useCallback(() => onShare(battle), [battle, onShare]);
  const vote = useCallback(
    (side: "A" | "B") => onVote(battle.id, side),
    [battle.id, onVote]
  );

  return (
    <Animated.View
      entering={reducedMotion ? undefined : FadeIn.duration(240)}
      style={styles.card}
    >
      {/* Status strip */}
      <View style={styles.statusRow}>
        <View style={styles.liveChip}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>HOT RIGHT NOW</Text>
        </View>
        {!!remaining && remaining !== "Ended" && (
          <View style={styles.timeChip}>
            <Feather name="clock" size={11} color={COLORS.textSecondary} />
            <Text style={styles.timeText}>{remaining}</Text>
          </View>
        )}
      </View>

      {/* Matchup */}
      <View style={styles.matchup}>
        <Side
          player={battle.playerA}
          side="A"
          percent={percentA}
          votes={votesA}
          isVoted={userVote === "A"}
          canVote={canVote}
          onVote={vote}
          onOpenMedia={open}
          onOpenAthlete={onOpenAthlete}
        />

        <View style={styles.vsColumn} pointerEvents="none">
          <View style={styles.vsBadge}>
            <Text style={styles.vsText}>VS</Text>
          </View>
        </View>

        <Side
          player={battle.playerB}
          side="B"
          percent={percentB}
          votes={votesB}
          isVoted={userVote === "B"}
          canVote={canVote}
          onVote={vote}
          onOpenMedia={open}
          onOpenAthlete={onOpenAthlete}
        />
      </View>

      {/* Live split bar — real counts only */}
      <View style={styles.splitWrap}>
        {total > 0 ? (
          <>
            <View style={styles.splitBar}>
              <View style={[styles.splitA, { flex: percentA ?? 50 }]} />
              <View style={[styles.splitB, { flex: percentB ?? 50 }]} />
            </View>
            <Text style={styles.splitTotal}>
              {total} {total === 1 ? "vote" : "votes"} cast
            </Text>
          </>
        ) : (
          <Text style={styles.splitTotal}>No votes yet — cast the first one</Text>
        )}
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        <Pressable
          onPress={open}
          accessibilityRole="button"
          accessibilityLabel="Open the full battle view"
          style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}
        >
          <Feather name="maximize-2" size={14} color={COLORS.textPrimary} />
          <Text style={styles.actionText}>View Battle</Text>
        </Pressable>

        <Pressable
          onPress={share}
          hitSlop={HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel="Share this battle"
          style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}
        >
          <Feather name="send" size={14} color={COLORS.textPrimary} />
          <Text style={styles.actionText}>Share Battle</Text>
        </Pressable>

        {/* Only rendered when another votable battle exists to skip to. */}
        {onSkip && (
          <Pressable
            onPress={onSkip}
            hitSlop={HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel="Skip to the next battle"
            style={({ pressed }) => [styles.skipBtn, pressed && styles.pressed]}
          >
            <MaterialCommunityIcons
              name="skip-next"
              size={16}
              color={COLORS.textSecondary}
            />
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

export default memo(FeaturedBattle);

const styles = StyleSheet.create({
  card: {
    marginHorizontal: SPACING.lg,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.surfaceRaised,
    overflow: "hidden",
  },
  pressed: { opacity: 0.78 },

  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
  },
  liveChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADIUS.xs,
    backgroundColor: COLORS.liveFaint,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.live },
  liveText: {
    color: COLORS.live,
    fontSize: TYPE.micro,
    fontWeight: FONTS.heavy,
    letterSpacing: 0.6,
  },
  timeChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  timeText: {
    color: COLORS.textSecondary,
    fontSize: TYPE.micro,
    fontWeight: FONTS.bold,
  },

  matchup: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
  },
  side: { flex: 1, gap: 6 },
  media: {
    width: "100%",
    aspectRatio: 3 / 4,
    borderRadius: RADIUS.md,
    overflow: "hidden",
    backgroundColor: COLORS.surfaceDeep,
  },
  mediaEmpty: { flex: 1, alignItems: "center", justifyContent: "center" },
  votedBadge: {
    position: "absolute",
    top: SPACING.sm,
    right: SPACING.sm,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.scrimBadge,
  },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    minHeight: 40,
  },
  identityText: { flex: 1, gap: 0 },
  name: {
    color: COLORS.textPrimary,
    fontSize: TYPE.footnote,
    fontWeight: FONTS.bold,
  },
  handle: { color: COLORS.textHandle, fontSize: TYPE.micro },
  percent: { fontSize: 26, fontWeight: FONTS.heavy, letterSpacing: -0.5 },
  percentEmpty: {
    color: COLORS.textMuted,
    fontSize: 26,
    fontWeight: FONTS.heavy,
  },
  voteCount: { color: COLORS.textMuted, fontSize: TYPE.micro, marginTop: -4 },

  voteBtn: {
    minHeight: 44,
    marginTop: SPACING.sm,
    borderRadius: RADIUS.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: SPACING.sm,
  },
  voteBtnA: { backgroundColor: COLORS.accent, ...GLOW.accent },
  voteBtnB: { backgroundColor: COLORS.accent },
  voteBtnVoted: {
    backgroundColor: COLORS.transparent,
    borderWidth: 1,
    borderColor: COLORS.accentBorderFaint,
    shadowOpacity: 0,
    elevation: 0,
  },
  voteBtnDisabled: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    shadowOpacity: 0,
    elevation: 0,
  },
  voteBtnText: {
    color: COLORS.black,
    fontSize: TYPE.micro,
    fontWeight: FONTS.heavy,
    letterSpacing: 0.4,
  },
  voteBtnTextDisabled: { color: COLORS.textMuted },

  vsColumn: {
    width: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 60,
  },
  vsBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.background,
    borderWidth: 1.5,
    borderColor: COLORS.accent,
    ...GLOW.accent,
  },
  vsText: {
    color: COLORS.accent,
    fontSize: TYPE.footnote,
    fontWeight: FONTS.heavy,
    letterSpacing: 0.5,
  },

  splitWrap: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    gap: 6,
  },
  splitBar: {
    flexDirection: "row",
    height: 6,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: COLORS.inputBorder,
  },
  splitA: { backgroundColor: COLORS.accent },
  splitB: { backgroundColor: COLORS.accent2 },
  splitTotal: {
    color: COLORS.textMuted,
    fontSize: TYPE.micro,
    textAlign: "center",
  },

  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    padding: SPACING.md,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 42,
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
  skipBtn: {
    width: 42,
    height: 42,
    borderRadius: RADIUS.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.surface,
  },
});
