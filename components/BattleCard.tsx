import React, { memo, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Dimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import Animated, { FadeIn, useReducedMotion } from "react-native-reanimated";
import { COLORS, SPACING, RADIUS, FONTS, TYPE } from "@/constants/theme";
import AvatarImage from "./AvatarImage";
import GlowButton from "./GlowButton";
import BattleMedia from "./BattleMedia";
import BattleStatusBadge from "./BattleStatusBadge";
import VoteBar from "./VoteBar";
import IconButton from "./IconButton";
import { openAthleteProfile } from "@/utils/navigation";
import { toHandle } from "@/utils/format";
import { shareBattle } from "@/utils/shareBattle";
import { isVideoMedia, normalizeFirebaseStorageUrl } from "@/utils/media";
import type { Battle, BattlePlayer } from "@/types";
import { getBattleStatus, timeRemaining } from "@/hooks/useBattles";

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

// ── Open slot placeholder ────────────────────────────────────────────────────
function OpenSlot({ thumbW, thumbH }: { thumbW: number; thumbH: number }) {
  return (
    <View style={[styles.thumbWrapper, { width: thumbW, height: thumbH }, styles.openSlot]}>
      <Feather name="clock" size={22} color={COLORS.accent} />
      <Text style={styles.openSlotText}>Waiting for{"\n"}challenger</Text>
    </View>
  );
}

// ── Incomplete card ──────────────────────────────────────────────────────────
function IncompleteBattleCard() {
  return (
    <View style={[styles.card, styles.incompleteCard]}>
      <MaterialCommunityIcons name="sword-cross" size={28} color={COLORS.textMuted} />
      <Text style={styles.incompleteTitle}>Waiting for challenger</Text>
      <Text style={styles.incompleteSub}>This battle is being set up.</Text>
    </View>
  );
}

// ── Player column — avatar → name → highlight, fight-card style ─────────────
function PlayerCol({
  player,
  side,
  userVote,
  isCompleted,
  winner,
  canVote,
  onVote,
  battleId,
  thumbW,
  thumbH,
  currentUserId,
  autoPlayMedia,
  reducedMotion,
}: {
  player: BattlePlayer | null;
  side: "A" | "B";
  userVote: "A" | "B" | null;
  isCompleted: boolean;
  winner: string | null;
  canVote: boolean;
  onVote: (battleId: string, side: "A" | "B") => void;
  battleId: string;
  thumbW: number;
  thumbH: number;
  currentUserId?: string | null;
  autoPlayMedia: boolean;
  reducedMotion: boolean;
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
      {/* Avatar + name + handle — tappable to navigate to profile */}
      <Pressable
        onPress={goToProfile}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        accessibilityRole="link"
        accessibilityLabel={`View ${player.username}'s profile`}
        style={styles.playerIdentity}
      >
        <View
          style={[
            styles.playerAvatarRing,
            myVote && styles.playerAvatarRingVoted,
            isWinner && styles.playerAvatarRingWinner,
          ]}
        >
          <AvatarImage uri={player.avatar || null} username={player.username || "?"} size={32} />
        </View>
        <Text style={styles.playerName} numberOfLines={1}>{player.username}</Text>
        <Text style={styles.playerHandle} numberOfLines={1}>{toHandle(player.username)}</Text>
      </Pressable>

      {/* Thumbnail — tappable to vote */}
      {/* MediaTile receives explicit pixel dimensions (thumbW × thumbH) so the
          internal Image can use absoluteFillObject without % resolution issues. */}
      <Pressable
        onPress={isVideo || canVote ? handleThumbPress : undefined}
        accessibilityRole={canVote ? "button" : undefined}
        accessibilityLabel={
          canVote
            ? `Vote for ${player.username}`
            : isVideo
            ? `${player.username}'s video. Tap to play or pause.`
            : `${player.username}'s post`
        }
        style={[
          styles.thumbWrapper,
          { width: thumbW, height: thumbH },
          isWinner && styles.thumbWrapperWinner,
        ]}
      >
        <BattleMedia
          uri={player.mediaUrl || null}
          mediaType={player.mediaType}
          playing={isVideo && isPlaying}
          style={{ width: thumbW, height: thumbH }}
          context="BattleCard"
        />

        {/* Voted overlay — fades in on vote */}
        {myVote && (
          <Animated.View
            entering={reducedMotion ? undefined : FadeIn.duration(220)}
            style={styles.votedOverlay}
            accessible
            accessibilityLabel="Your vote"
          >
            <Feather name="check-circle" size={40} color={COLORS.accent} />
            <Text style={styles.votedOverlayText}>YOUR VOTE</Text>
          </Animated.View>
        )}

        {/* Winner banner — gold, restrained reveal */}
        {isWinner && (
          <Animated.View
            entering={reducedMotion ? undefined : FadeIn.duration(300)}
            style={styles.winnerBadge}
          >
            <MaterialCommunityIcons name="trophy" size={12} color={COLORS.warning} />
            <Text style={styles.winnerText}>BATTLE WINNER</Text>
          </Animated.View>
        )}

        {/* Tap to vote hint */}
        {canVote && !myVote && (
          <View style={styles.tapToVote}>
            <Text style={styles.tapToVoteText}>Tap to vote</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

// ── Main BattleCard ──────────────────────────────────────────────────────────
// PERF: memoized — all props are primitives or stable references (onVote /
// onAccept are useCallback-stable in callers; battle object identity only
// changes when its data actually changes). Prevents every visible card from
// re-rendering its media tree when the Battles screen re-renders for modal
// open/close or unrelated state.
function BattleCard({
  battle,
  userVote,
  onVote,
  onAccept,
  currentUserId,
  featured = false,
  autoPlayMedia = false,
}: Props) {
  const reducedMotion = useReducedMotion();

  if (!battle?.playerA) return <IncompleteBattleCard />;

  const thumbW = featured ? FEAT_THUMB_W : THUMB_W;
  const thumbH = featured ? FEAT_THUMB_H : THUMB_H;

  const votesA = battle.votesA ?? 0;
  const votesB = battle.votesB ?? 0;
  const totalVotes = votesA + votesB;
  const pctA = totalVotes > 0 ? Math.round((votesA / totalVotes) * 100) : 50;
  const pctB = 100 - pctA;

  // Single derived-status source (folds expiry into "completed").
  const status = getBattleStatus(battle);
  const remaining = timeRemaining(battle);
  const isOpen = status === "open";
  const isLive = status === "live";
  const isCompleted = status === "completed";

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

  // Own open challenge (creator or playerA) — waiting state, no action.
  const isWaitingForOpponent =
    isOpen && !battle.playerB &&
    (mySide !== null || battle.creatorId === currentUserId);

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
          <BattleStatusBadge status={status} compact />
          {!!battle.category && <Text style={styles.category}>{battle.category}</Text>}
        </View>

        <View style={styles.statusRight}>
          <IconButton
            icon="share"
            size={26}
            accessibilityLabel="Share battle"
            onPress={handleShare}
          />
          {mySide ? (
            <Text style={styles.myStatus}>
              {isOpen ? "Open" : isLive ? "Live" :
               battle.winner === currentUserId ? "Won" : "Lost"}
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
          winner={battle.winner}
          canVote={canVote}
          onVote={onVote} battleId={battle.id}
          thumbW={thumbW} thumbH={thumbH}
          currentUserId={currentUserId}
          autoPlayMedia={autoPlayMedia}
          reducedMotion={reducedMotion}
        />

        {/* Fight-card VS treatment */}
        <View style={styles.vsCol}>
          <View style={styles.vsRule} />
          <Text style={[styles.vs, featured && styles.vsFeatured]}>VS</Text>
          <View style={styles.vsRule} />
        </View>

        <PlayerCol
          player={battle.playerB} side="B"
          userVote={userVote} isCompleted={isCompleted}
          winner={battle.winner}
          canVote={canVote}
          onVote={onVote} battleId={battle.id}
          thumbW={thumbW} thumbH={thumbH}
          currentUserId={currentUserId}
          autoPlayMedia={autoPlayMedia}
          reducedMotion={reducedMotion}
        />
      </View>

      {/* ── Vote bar ────────────────────────────────────────────────────────── */}
      {!isOpen && (
        <View style={styles.voteBarSection}>
          <VoteBar
            pctA={pctA}
            pctB={pctB}
            totalVotes={totalVotes}
            nameA={battle.playerA?.username}
            nameB={battle.playerB?.username}
          />
        </View>
      )}

      {/* ── Vote Now button ──────────────────────────────────────────────────── */}
      {canVote && (
        <View style={styles.voteNowSection}>
          <Text style={styles.voteHint}>Which highlight is stronger? Cast your vote.</Text>
          <View style={styles.voteButtons}>
            <GlowButton
              label={`Vote ${battle.playerA?.username ?? "A"}`}
              onPress={() => onVote(battle.id, "A")}
              variant="primary"
              size="sm"
              style={styles.voteBtn}
              accessibilityLabel={`Vote for ${battle.playerA?.username ?? "Player A"}`}
            />
            <GlowButton
              label={`Vote ${battle.playerB?.username ?? "B"}`}
              onPress={() => onVote(battle.id, "B")}
              variant="secondary"
              size="sm"
              style={styles.voteBtn}
              accessibilityLabel={`Vote for ${battle.playerB?.username ?? "Player B"}`}
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
            accessibilityLabel={`Accept challenge from ${battle.playerA?.username ?? "this athlete"}`}
          />
        </View>
      )}

      {/* ── Waiting for opponent (own open challenge) ────────────────────────── */}
      {isWaitingForOpponent && (
        <View style={styles.waitingRow} accessible accessibilityLabel="Waiting for an opponent to accept">
          <Feather name="clock" size={13} color={COLORS.textMuted} />
          <Text style={styles.waitingText}>Waiting for an opponent…</Text>
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

export default memo(BattleCard);

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
    borderColor: COLORS.accentBorderFaint,
    backgroundColor: COLORS.surfaceRaised,
  },

  // Incomplete
  incompleteCard: {
    alignItems: "center",
    justifyContent: "center",
    padding: SPACING.xl,
    gap: SPACING.sm,
    borderStyle: "dashed",
  },
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
    gap: 6,
  },
  playerIdentity: {
    alignItems: "center",
    gap: 2,
  },
  playerAvatarRing: {
    borderRadius: 20,
    borderWidth: 2,
    borderColor: COLORS.cardBorder,
    padding: 1,
    marginBottom: 2,
  },
  playerAvatarRingVoted: { borderColor: COLORS.accent },
  playerAvatarRingWinner: { borderColor: COLORS.warning },
  playerName: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: FONTS.bold,
    textAlign: "center",
    letterSpacing: 0.2,
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
    gap: 6,
  },
  vsRule: {
    width: 1.5,
    height: 18,
    backgroundColor: COLORS.accentBorderFaint,
    borderRadius: 1,
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
  thumbWrapperWinner: {
    borderWidth: 1.5,
    borderColor: COLORS.warningBorder,
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
  openSlotText: { color: COLORS.textMuted, fontSize: TYPE.caption, textAlign: "center" },

  // Overlays
  votedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.scrim,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  votedOverlayText: {
    color: COLORS.accent,
    fontSize: TYPE.micro,
    fontWeight: FONTS.extrabold,
    letterSpacing: 1,
  },
  winnerBadge: {
    position: "absolute",
    bottom: 6,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.scrimHeavy,
    borderWidth: 1,
    borderColor: COLORS.warningBorder,
    borderRadius: RADIUS.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  winnerText: { color: COLORS.warning, fontSize: TYPE.caption, fontWeight: FONTS.heavy },
  tapToVote: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.accentSoft,
    paddingVertical: 5,
    alignItems: "center",
  },
  tapToVoteText: { color: COLORS.accent, fontSize: TYPE.caption, fontWeight: FONTS.bold },

  // Vote bar
  voteBarSection: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.sm,
  },

  // Vote Now
  voteNowSection: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.md,
  },
  voteHint: {
    color: COLORS.textMuted,
    fontSize: 11,
    textAlign: "center",
    marginTop: SPACING.xs,
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

  // Waiting for opponent
  waitingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingBottom: SPACING.md,
  },
  waitingText: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: FONTS.semibold,
  },

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
