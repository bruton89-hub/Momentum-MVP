import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Dimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { COLORS, SPACING, RADIUS, FONTS } from "@/constants/theme";
import AvatarImage from "./AvatarImage";
import GlowButton from "./GlowButton";
import BattleMedia from "./BattleMedia";
import { openAthleteProfile } from "@/utils/navigation";
import { shareBattle } from "@/utils/shareBattle";
import { isVideoMedia, normalizeFirebaseStorageUrl } from "@/utils/media";
import type { Battle, BattlePlayer } from "@/types";
import { isBattleExpired, timeRemaining } from "@/hooks/useBattles";

const { width: SCREEN_W } = Dimensions.get("window");
const CARD_PAD = SPACING.md;
const THUMB_W = (SCREEN_W - CARD_PAD * 2 - 60) / 2; // 60px for VS column
const THUMB_H = Math.round(THUMB_W * 1.35);

// ── Featured (hero) card uses larger thumbnails ──────────────────────────────
const FEAT_THUMB_W = (SCREEN_W - CARD_PAD * 2 - 70) / 2;
const FEAT_THUMB_H = Math.round(FEAT_THUMB_W * 1.4);

interface Props {
  battle: Battle;
  userVote: "A" | "B" | null;
  onVote: (battleId: string, side: "A" | "B") => void;
  onAccept?: (battleId: string) => void;
  currentUserId?: string | null;
  /** First live battle in the list — rendered as a hero card */
  featured?: boolean;
  autoPlayMedia?: boolean;
}

function toHandle(username: string): string {
  return "@" + username.toLowerCase().replace(/\s+/g, ".");
}

// ── Open slot placeholder ────────────────────────────────────────────────────
function OpenSlot({ thumbW, thumbH }: { thumbW: number; thumbH: number }) {
  return (
    <View style={[styles.thumbWrapper, { width: thumbW, height: thumbH }, styles.openSlot]}>
      <Text style={styles.openSlotIcon}>⏳</Text>
      <Text style={styles.openSlotText}>Waiting for{"\n"}challenger</Text>
    </View>
  );
}

// ── Incomplete card ──────────────────────────────────────────────────────────
function IncompleteBattleCard() {
  return (
    <View style={[styles.card, styles.incompleteCard]}>
      <Text style={styles.incompleteIcon}>⚔️</Text>
      <Text style={styles.incompleteTitle}>Waiting for challenger</Text>
      <Text style={styles.incompleteSub}>This battle is being set up.</Text>
    </View>
  );
}

// ── Player column ────────────────────────────────────────────────────────────
function PlayerCol({
  player,
  side,
  userVote,
  isCompleted,
  winner,
  votesA,
  votesB,
  isOpen,
  canVote,
  onVote,
  battleId,
  thumbW,
  thumbH,
  currentUserId,
  autoPlayMedia,
}: {
  player: BattlePlayer | null;
  side: "A" | "B";
  userVote: "A" | "B" | null;
  isCompleted: boolean;
  winner: string | null;
  votesA: number;
  votesB: number;
  isOpen: boolean;
  canVote: boolean;
  onVote: (battleId: string, side: "A" | "B") => void;
  battleId: string;
  thumbW: number;
  thumbH: number;
  currentUserId?: string | null;
  autoPlayMedia: boolean;
}) {
  // useRouter must be called before any early return (Rules of Hooks)
  const router = useRouter();
  const myVote = userVote === side;
  const isWinner = isCompleted && !!player?.userId && winner === player.userId;
  const [isPlaying, setIsPlaying] = useState(autoPlayMedia);
  const normalizedMediaUrl = useMemo(
    () => normalizeFirebaseStorageUrl(player?.mediaUrl),
    [player?.mediaUrl]
  );
  const isVideo = isVideoMedia(normalizedMediaUrl || player?.mediaUrl, player?.mediaType);

  useEffect(() => {
    setIsPlaying(autoPlayMedia);
  }, [autoPlayMedia, battleId, player?.mediaUrl]);

  function goToProfile() {
    openAthleteProfile(router, player?.userId, currentUserId);
  }

  function handleThumbPress() {
    if (canVote) {
      onVote(battleId, side);
      return;
    }
    if (isVideo) {
      setIsPlaying((current) => !current);
    }
  }

  if (!player) {
    return (
      <View style={styles.playerCol}>
        <OpenSlot thumbW={thumbW} thumbH={thumbH} />
      </View>
    );
  }

  return (
    <View style={styles.playerCol}>
      {/* Player name + handle — tappable to navigate to profile */}
      <Pressable onPress={goToProfile} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
        <Text style={styles.playerName} numberOfLines={1}>{player.username}</Text>
        <Text style={styles.playerHandle} numberOfLines={1}>{toHandle(player.username)}</Text>
      </Pressable>

      {/* Thumbnail — tappable to vote */}
      {/* MediaTile receives explicit pixel dimensions (thumbW × thumbH) so the
          internal Image can use absoluteFillObject without % resolution issues. */}
      <Pressable
        onPress={isVideo || canVote ? handleThumbPress : undefined}
        style={[styles.thumbWrapper, { width: thumbW, height: thumbH }]}
      >
        <BattleMedia
          uri={player.mediaUrl || null}
          mediaType={player.mediaType}
          playing={isVideo && isPlaying}
          style={{ width: thumbW, height: thumbH }}
          context="BattleCard"
        />

        {/* Voted overlay */}
        {myVote && (
          <View style={styles.votedOverlay}>
            <Text style={styles.votedCheck}>✓</Text>
          </View>
        )}

        {/* Winner crown — prominent bottom banner */}
        {isWinner && (
          <View style={styles.winnerBadge}>
            <Text style={styles.winnerText}>👑 WINNER</Text>
          </View>
        )}

        {/* Tap to vote hint */}
        {canVote && !myVote && (
          <View style={styles.tapToVote}>
            <Text style={styles.tapToVoteText}>Tap to vote</Text>
          </View>
        )}
      </Pressable>

      {/* Avatar — tappable to navigate to profile */}
      <Pressable onPress={goToProfile} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
        <AvatarImage uri={player.avatar || null} username={player.username || "?"} size={22} />
      </Pressable>
    </View>
  );
}

// ── Main BattleCard ──────────────────────────────────────────────────────────
export default function BattleCard({
  battle,
  userVote,
  onVote,
  onAccept,
  currentUserId,
  featured = false,
  autoPlayMedia = false,
}: Props) {
  if (!battle?.playerA) return <IncompleteBattleCard />;

  const thumbW = featured ? FEAT_THUMB_W : THUMB_W;
  const thumbH = featured ? FEAT_THUMB_H : THUMB_H;

  const votesA = battle.votesA ?? 0;
  const votesB = battle.votesB ?? 0;
  const totalVotes = votesA + votesB;
  const pctA = totalVotes > 0 ? Math.round((votesA / totalVotes) * 100) : 50;
  const pctB = 100 - pctA;

  const expired    = isBattleExpired(battle);
  const remaining  = timeRemaining(battle);
  const isOpen      = battle.status === "open";
  const isLive      = battle.status === "live" && !expired;
  const isCompleted = battle.status === "completed" || (battle.status === "live" && expired);

  const canVote =
    isLive && !userVote && !!currentUserId && !!battle.playerB &&
    currentUserId !== battle.playerA?.userId &&
    currentUserId !== battle.playerB?.userId;

  const canAccept =
    isOpen && !!battle.playerA && !battle.playerB && !!currentUserId &&
    currentUserId !== battle.playerA?.userId;

  const mySide =
    currentUserId && battle.playerA?.userId === currentUserId ? "A" :
    currentUserId && battle.playerB?.userId === currentUserId ? "B" : null;

  async function handleShare() {
    try {
      await shareBattle(battle);
    } catch (err) {
      console.error("[BattleCard] share failed:", err);
    }
  }

  return (
    <View style={[styles.card, featured && styles.cardFeatured]}>

      {/* ── Status bar ──────────────────────────────────────────────────────── */}
      <View style={styles.statusRow}>
        <View style={styles.statusLeft}>
          <View style={[
            styles.statusBadge,
            isLive      && styles.liveBadge,
            isCompleted && styles.completedBadge,
            isOpen      && styles.openBadge,
          ]}>
            <Text style={[
              styles.statusText,
              isLive      && styles.liveText,
              isCompleted && styles.completedText,
              isOpen      && styles.openText,
            ]}>
              {isLive ? "🏆 LIVE BATTLE" : isCompleted ? "✅ COMPLETED" : "🔓 OPEN CHALLENGE"}
            </Text>
          </View>
          {!!battle.category && <Text style={styles.category}>{battle.category}</Text>}
        </View>

        <View style={styles.statusRight}>
          <Pressable
            onPress={(event) => {
              event.stopPropagation?.();
              handleShare();
            }}
            style={styles.shareBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.shareIcon}>↗</Text>
          </Pressable>
          {mySide ? (
            <Text style={styles.myStatus}>
              {isOpen ? "Open" : isLive ? "Live" :
               battle.winner === currentUserId ? "Won 🏆" : "Lost"}
            </Text>
          ) : null}
          {!isOpen && !!remaining && !mySide && (
            <Text style={styles.timer}>{remaining}</Text>
          )}
          <Text style={styles.v1Badge}>1v1</Text>
        </View>
      </View>

      {/* ── Category title (featured only) ──────────────────────────────────── */}
      {featured && !!battle.category && (
        <Text style={styles.featuredTitle}>{battle.category}</Text>
      )}

      {/* ── Players ─────────────────────────────────────────────────────────── */}
      <View style={styles.playersRow}>
        <PlayerCol
          player={battle.playerA} side="A"
          userVote={userVote} isCompleted={isCompleted}
          winner={battle.winner} votesA={votesA} votesB={votesB}
          isOpen={isOpen} canVote={canVote}
          onVote={onVote} battleId={battle.id}
          thumbW={thumbW} thumbH={thumbH}
          currentUserId={currentUserId}
          autoPlayMedia={autoPlayMedia}
        />

        <View style={styles.vsCol}>
          <Text style={[styles.vs, featured && styles.vsFeatured]}>VS</Text>
        </View>

        <PlayerCol
          player={battle.playerB} side="B"
          userVote={userVote} isCompleted={isCompleted}
          winner={battle.winner} votesA={votesA} votesB={votesB}
          isOpen={isOpen} canVote={canVote}
          onVote={onVote} battleId={battle.id}
          thumbW={thumbW} thumbH={thumbH}
          currentUserId={currentUserId}
          autoPlayMedia={autoPlayMedia}
        />
      </View>

      {/* ── Vote bar ────────────────────────────────────────────────────────── */}
      {!isOpen && (
        <View style={styles.voteBarSection}>
          <View style={styles.voteBarLabels}>
            <Text style={styles.voteBarPctA}>{pctA}%</Text>
            <Text style={styles.voteBarTotal}>{totalVotes.toLocaleString()} votes</Text>
            <Text style={styles.voteBarPctB}>{pctB}%</Text>
          </View>
          <View style={styles.voteBarTrack}>
            <View style={[styles.voteBarFillA, { flex: pctA }]} />
            <View style={[styles.voteBarFillB, { flex: pctB }]} />
          </View>
        </View>
      )}

      {/* ── Vote Now button ──────────────────────────────────────────────────── */}
      {canVote && (
        <View style={styles.voteNowSection}>
          <View style={styles.voteButtons}>
            <GlowButton
              label={`Vote ${battle.playerA?.username ?? "A"}`}
              onPress={() => onVote(battle.id, "A")}
              variant="primary"
              size="sm"
              style={styles.voteBtn}
            />
            <GlowButton
              label={`Vote ${battle.playerB?.username ?? "B"}`}
              onPress={() => onVote(battle.id, "B")}
              variant="secondary"
              size="sm"
              style={styles.voteBtn}
            />
          </View>
        </View>
      )}

      {/* ── Accept challenge ─────────────────────────────────────────────────── */}
      {canAccept && onAccept && (
        <View style={styles.acceptSection}>
          <GlowButton
            label="Accept Challenge"
            onPress={() => onAccept(battle.id)}
            variant="primary"
            size="sm"
            style={styles.acceptBtn}
          />
        </View>
      )}

      {/* ── Own battle notice ────────────────────────────────────────────────── */}
      {mySide !== null && isLive && !isCompleted && (
        <Text style={styles.ownBattleMsg}>You can't vote in your own battle</Text>
      )}

      {/* ── Voted confirmation (show who was voted for) ───────────────────────── */}
      {userVote && (isLive || isCompleted) && (
        <Text style={styles.votedMsg}>
          You voted for{" "}
          {userVote === "A"
            ? (battle.playerA?.username ?? "Player A")
            : (battle.playerB?.username ?? "Player B")}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.lg,
    overflow: "hidden",
  },
  cardFeatured: {
    borderColor: "rgba(166,255,0,0.25)",
    backgroundColor: "#131313",
  },

  // Incomplete
  incompleteCard: {
    alignItems: "center",
    justifyContent: "center",
    padding: SPACING.xl,
    gap: SPACING.sm,
    borderStyle: "dashed",
  },
  incompleteIcon: { fontSize: 28 },
  incompleteTitle: { color: COLORS.textSecondary, fontSize: 14, fontWeight: FONTS.semibold },
  incompleteSub: { color: COLORS.textMuted, fontSize: 12 },

  // Status row
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
  },
  statusLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
  },
  statusRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
  },
  shareBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  shareIcon: {
    color: COLORS.textSecondary,
    fontSize: 14,
    fontWeight: FONTS.heavy,
  },
  statusBadge: {
    borderRadius: RADIUS.xs,
    paddingHorizontal: 7,
    paddingVertical: 3,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
  },
  liveBadge: { backgroundColor: COLORS.liveFaint, borderColor: COLORS.live },
  completedBadge: { backgroundColor: COLORS.accentFaint, borderColor: COLORS.accent },
  openBadge: { backgroundColor: COLORS.surface, borderColor: COLORS.inputBorder },
  statusText: { color: COLORS.textMuted, fontSize: 10, fontWeight: FONTS.heavy, letterSpacing: 0.5 },
  liveText: { color: COLORS.live },
  completedText: { color: COLORS.accent },
  openText: { color: COLORS.textSecondary },
  category: { color: COLORS.textMuted, fontSize: 12, fontWeight: FONTS.medium, flexShrink: 1 },
  timer: { color: COLORS.textMuted, fontSize: 11, fontWeight: FONTS.semibold },
  myStatus: { color: COLORS.accent, fontSize: 11, fontWeight: FONTS.heavy },
  v1Badge: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontWeight: FONTS.heavy,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: RADIUS.xs,
    paddingHorizontal: 5,
    paddingVertical: 2,
    overflow: "hidden",
  },

  // Featured title
  featuredTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: FONTS.heavy,
    textAlign: "center",
    paddingTop: SPACING.md,
    paddingHorizontal: SPACING.lg,
  },

  // Players
  playersRow: {
    flexDirection: "row",
    paddingHorizontal: CARD_PAD,
    paddingVertical: SPACING.md,
    alignItems: "center",
    gap: 0,
  },
  playerCol: {
    flex: 1,
    alignItems: "center",
    gap: 4,
  },
  playerName: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: FONTS.bold,
    textAlign: "center",
  },
  playerHandle: {
    color: COLORS.textHandle,
    fontSize: 11,
    textAlign: "center",
    marginBottom: 4,
  },
  vsCol: {
    width: 60,
    alignItems: "center",
    justifyContent: "center",
  },
  vs: {
    color: COLORS.accent,
    fontSize: 22,
    fontWeight: FONTS.heavy,
    letterSpacing: 2,
  },
  vsFeatured: {
    fontSize: 30,
    letterSpacing: 3,
  },

  // Thumbnails
  thumbWrapper: {
    borderRadius: RADIUS.md,
    overflow: "hidden",
    backgroundColor: COLORS.surface,
    position: "relative",
  },
  // Open slot
  openSlot: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: COLORS.inputBorder,
    borderStyle: "dashed",
    gap: 4,
  },
  openSlotIcon: { color: COLORS.accent, fontSize: 22, fontWeight: FONTS.heavy },
  openSlotText: { color: COLORS.textMuted, fontSize: 11, textAlign: "center" },

  // Overlays
  votedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  votedCheck: { color: COLORS.accent, fontSize: 44, fontWeight: FONTS.heavy },
  winnerBadge: {
    position: "absolute",
    bottom: 6,
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.78)",
    borderRadius: RADIUS.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  winnerText: { color: COLORS.accent, fontSize: 11, fontWeight: FONTS.heavy },
  tapToVote: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(166,255,0,0.18)",
    paddingVertical: 5,
    alignItems: "center",
  },
  tapToVoteText: { color: COLORS.accent, fontSize: 11, fontWeight: FONTS.bold },

  // Vote bar
  voteBarSection: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.sm,
    gap: 5,
  },
  voteBarLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  voteBarPctA: { color: COLORS.accent, fontSize: 14, fontWeight: FONTS.heavy },
  voteBarPctB: { color: COLORS.textSecondary, fontSize: 14, fontWeight: FONTS.heavy },
  voteBarTotal: { color: COLORS.textMuted, fontSize: 11 },
  voteBarTrack: {
    flexDirection: "row",
    height: 10,
    borderRadius: RADIUS.full,
    overflow: "hidden",
    backgroundColor: COLORS.surface,
  },
  voteBarFillA: { backgroundColor: COLORS.accent },
  voteBarFillB: { backgroundColor: COLORS.inputBorder },

  // Vote Now
  voteNowSection: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.md,
  },
  voteButtons: {
    flexDirection: "row",
    gap: SPACING.sm,
    marginTop: SPACING.sm,
  },
  voteBtn: { flex: 1 },

  // Accept
  acceptSection: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.md,
  },
  acceptBtn: {},

  // Voted msg
  votedMsg: {
    color: COLORS.accent,
    fontSize: 12,
    fontWeight: FONTS.semibold,
    textAlign: "center",
    paddingBottom: SPACING.sm,
    paddingTop: 2,
  },

  // Own-battle notice
  ownBattleMsg: {
    color: COLORS.textMuted,
    fontSize: 11,
    textAlign: "center",
    paddingBottom: SPACING.xs,
    paddingTop: 2,
    fontStyle: "italic",
  },
});
