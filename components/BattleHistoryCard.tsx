import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { COLORS, SPACING, RADIUS, FONTS, TYPE, HIT_SLOP } from "@/constants/theme";
import MediaTile from "./MediaTile";
import { openAthleteProfile } from "@/utils/navigation";
import { formatBattleDate } from "@/utils/format";
import type { Battle } from "@/types";

interface Props {
  battle: Battle;
  /** The profile owner these rows belong to (win/loss is relative to them). */
  userId: string;
  currentUserId: string | null;
  /** Diagnostic label passed through to MediaTile logs. */
  context?: string;
}

/**
 * Win/loss battle history row — shared by both profile screens
 * (previously duplicated, styles and all, in each).
 */
export default function BattleHistoryCard({
  battle,
  userId,
  currentUserId,
  context = "BattleHistoryCard",
}: Props) {
  const router = useRouter();
  const mine = battle.playerA?.userId === userId ? battle.playerA : battle.playerB;
  const opponent = battle.playerA?.userId === userId ? battle.playerB : battle.playerA;
  const result = battle.winner
    ? battle.winner === userId
      ? "WIN"
      : "LOSS"
    : battle.status.toUpperCase();
  const resultStyle =
    result === "WIN" ? styles.resultWin : result === "LOSS" ? styles.resultLoss : styles.resultLive;
  const date = formatBattleDate(battle.createdAt);

  return (
    <View
      style={styles.card}
      accessible
      accessibilityLabel={`${battle.category || "Battle"}, ${result.toLowerCase()}, vs ${
        opponent?.username || "open challenge"
      }, ${date}`}
    >
      {/* MediaTile fills the 68×68 thumb container safely on iOS */}
      <MediaTile
        uri={mine?.mediaUrl || null}
        mediaType={mine?.mediaType}
        style={styles.thumb}
        context={context}
      />
      <View style={styles.info}>
        <View style={styles.metaRow}>
          <Text style={[styles.resultPill, resultStyle]}>{result}</Text>
          <Text style={styles.date}>{date}</Text>
        </View>
        <Text style={styles.title} numberOfLines={1}>
          {battle.category || "Battle"}
        </Text>
        {/* Opponent name — tappable to navigate to their profile */}
        {opponent?.userId ? (
          <Pressable
            onPress={() => openAthleteProfile(router, opponent.userId, currentUserId)}
            hitSlop={HIT_SLOP}
            accessibilityRole="link"
            accessibilityLabel={`View ${opponent.username}'s profile`}
          >
            <Text style={[styles.opponent, styles.opponentLink]} numberOfLines={1}>
              vs {opponent.username}
            </Text>
          </Pressable>
        ) : (
          <Text style={styles.opponent} numberOfLines={1}>
            vs {opponent?.username || "Open challenge"}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
    gap: SPACING.md,
  },
  thumb: {
    width: 68,
    height: 68,
    borderRadius: RADIUS.md,
    overflow: "hidden",
    backgroundColor: COLORS.surface,
    flexShrink: 0,
  },
  info: { flex: 1 },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  resultPill: {
    overflow: "hidden",
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    fontSize: TYPE.caption,
    fontWeight: FONTS.heavy,
  },
  resultWin: { color: COLORS.accent, backgroundColor: COLORS.accentFaint },
  resultLoss: { color: COLORS.error, backgroundColor: COLORS.errorFaint },
  resultLive: { color: COLORS.textSecondary, backgroundColor: COLORS.input },
  date: { color: COLORS.textMuted, fontSize: TYPE.small },
  title: {
    color: COLORS.textPrimary,
    fontSize: TYPE.base,
    fontWeight: FONTS.bold,
    marginBottom: 2,
  },
  opponent: { color: COLORS.textSecondary, fontSize: TYPE.footnote },
  opponentLink: { color: COLORS.accent, textDecorationLine: "underline" },
});
