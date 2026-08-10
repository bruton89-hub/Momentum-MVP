import React, { memo, useCallback } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { COLORS, SPACING, RADIUS, FONTS, TYPE, HIT_SLOP } from "@/constants/theme";
import AvatarImage from "@/components/AvatarImage";
import MediaTile from "@/components/MediaTile";
import { getBattleStatus, getTimeRemainingLabel } from "@/hooks/useBattles";
import type { Battle, BattlePlayer } from "@/types";

interface Props {
  battle: Battle;
  /** The signed-in athlete, used to work out who the opponent is. */
  viewerUserId: string | null;
  onOpen: (battle: Battle) => void;
  onOpenAthlete: (userId: string) => void;
  onShare: (battle: Battle) => void;
}

/**
 * A battle the viewer is currently in — live, or an open challenge they sent.
 *
 * Shows the opponent from the viewer's perspective, the media preview, the
 * real vote split, and time remaining. Everything comes from the battle
 * document; nothing is estimated.
 */
function ActiveBattleRow({
  battle,
  viewerUserId,
  onOpen,
  onOpenAthlete,
  onShare,
}: Props) {
  const status = getBattleStatus(battle);
  const viewerIsA = battle.playerA?.userId === viewerUserId;
  const me: BattlePlayer | null = viewerIsA ? battle.playerA : battle.playerB;
  const opponent: BattlePlayer | null = viewerIsA ? battle.playerB : battle.playerA;

  const votesMe = Math.max(0, (viewerIsA ? battle.votesA : battle.votesB) ?? 0);
  const votesThem = Math.max(0, (viewerIsA ? battle.votesB : battle.votesA) ?? 0);
  const total = votesMe + votesThem;
  const percentMe = total > 0 ? Math.round((votesMe / total) * 100) : null;

  const remaining = getTimeRemainingLabel(battle);
  const opponentName = opponent?.username?.trim();
  const isOpen = status === "open";

  const open = useCallback(() => onOpen(battle), [battle, onOpen]);
  const share = useCallback(() => onShare(battle), [battle, onShare]);
  const openOpponent = useCallback(() => {
    if (opponent?.userId) onOpenAthlete(opponent.userId);
  }, [opponent?.userId, onOpenAthlete]);

  return (
    <View style={styles.row}>
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={
          isOpen
            ? "Your open challenge, waiting for an opponent. Open it."
            : `Live battle against ${opponentName || "an athlete"}. ` +
              (percentMe !== null
                ? `You're on ${percentMe} percent of ${total} votes.`
                : "No votes yet.") +
              " Open it."
        }
        style={({ pressed }) => [styles.main, pressed && styles.pressed]}
      >
        <View style={styles.thumb}>
          {me?.mediaUrl ? (
            <MediaTile
              uri={me.mediaUrl}
              mediaType={me.mediaType}
              style={StyleSheet.absoluteFillObject}
              context="ActiveBattle"
            />
          ) : (
            <View style={styles.thumbEmpty} />
          )}
        </View>

        <View style={styles.body}>
          <View style={styles.statusRow}>
            <View style={[styles.chip, isOpen ? styles.chipOpen : styles.chipLive]}>
              {!isOpen && <View style={styles.liveDot} />}
              <Text style={[styles.chipText, isOpen && styles.chipTextOpen]}>
                {isOpen ? "WAITING" : "LIVE"}
              </Text>
            </View>
            {!!remaining && remaining !== "Ended" && (
              <Text style={styles.time}>{remaining}</Text>
            )}
          </View>

          <Text style={styles.vsLine} numberOfLines={1}>
            {isOpen ? "Waiting for an opponent" : `vs ${opponentName || "an athlete"}`}
          </Text>

          {total > 0 ? (
            <>
              <View style={styles.splitBar}>
                <View style={[styles.splitMe, { flex: percentMe ?? 50 }]} />
                <View style={[styles.splitThem, { flex: 100 - (percentMe ?? 50) }]} />
              </View>
              <Text style={styles.splitLabel}>
                You {percentMe}% · {total} {total === 1 ? "vote" : "votes"}
              </Text>
            </>
          ) : (
            <Text style={styles.splitLabel}>
              {isOpen ? "No opponent yet" : "No votes yet"}
            </Text>
          )}
        </View>
      </Pressable>

      <View style={styles.sideActions}>
        {!!opponent?.userId && (
          <Pressable
            onPress={openOpponent}
            hitSlop={HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={`Open ${opponentName || "opponent"}'s profile`}
            style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
          >
            <AvatarImage
              uri={opponent.avatar}
              username={opponentName || "Athlete"}
              size={28}
            />
          </Pressable>
        )}
        <Pressable
          onPress={share}
          hitSlop={HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel="Share this battle"
          style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
        >
          <Feather name="send" size={16} color={COLORS.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
}

export default memo(ActiveBattleRow);

const THUMB = 64;

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.surfaceRaised,
  },
  pressed: { opacity: 0.78 },
  main: { flex: 1, flexDirection: "row", alignItems: "center", gap: SPACING.md },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: RADIUS.md,
    overflow: "hidden",
    backgroundColor: COLORS.surfaceDeep,
  },
  thumbEmpty: { flex: 1, backgroundColor: COLORS.surfaceDeep },
  body: { flex: 1, gap: 4 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: RADIUS.xs,
  },
  chipLive: { backgroundColor: COLORS.liveFaint },
  chipOpen: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  liveDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: COLORS.live },
  chipText: {
    color: COLORS.live,
    fontSize: TYPE.micro,
    fontWeight: FONTS.heavy,
    letterSpacing: 0.5,
  },
  chipTextOpen: { color: COLORS.textMuted },
  time: { color: COLORS.textMuted, fontSize: TYPE.micro },
  vsLine: {
    color: COLORS.textPrimary,
    fontSize: TYPE.footnote,
    fontWeight: FONTS.bold,
  },
  splitBar: {
    flexDirection: "row",
    height: 4,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: COLORS.inputBorder,
  },
  splitMe: { backgroundColor: COLORS.accent },
  splitThem: { backgroundColor: COLORS.accent2 },
  splitLabel: { color: COLORS.textMuted, fontSize: TYPE.micro },
  sideActions: { alignItems: "center", gap: SPACING.sm },
  iconBtn: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 17,
  },
});
