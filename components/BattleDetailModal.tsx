/**
 * BattleDetailModal
 *
 * Full-detail bottom-sheet modal for a single battle.
 * Shows status, time remaining/ended, player thumbnails, vote bar,
 * vote buttons, winner banner, and close button.
 *
 * Rules:
 *   - canVote: live + both players present + not own battle + not voted yet
 *   - canAccept: open + playerB missing + not own battle
 *   - owner: can see status but cannot vote
 *   - voted: shows "You voted for X"
 *   - completed: shows winner banner (client-side from vote counts if no stored winner)
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  StyleSheet,
  ScrollView,
  Dimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import Animated, { FadeInDown, useReducedMotion } from "react-native-reanimated";
import { COLORS, FONTS, SPACING, RADIUS, TYPE, HIT_SLOP } from "@/constants/theme";
import AvatarImage from "./AvatarImage";
import GlowButton from "./GlowButton";
import BattleMedia from "./BattleMedia";
import BattleStatusBadge from "./BattleStatusBadge";
import VoteBar from "./VoteBar";
import IconButton from "./IconButton";
import { openAthleteProfile } from "@/utils/navigation";
import { toHandle, formatBattleDate } from "@/utils/format";
import { shareBattle } from "@/utils/shareBattle";
import { isVideoMedia, normalizeFirebaseStorageUrl } from "@/utils/media";
import {
  getBattleStatus,
  getBattleWinner,
  getTimeRemainingLabel,
} from "@/hooks/useBattles";
import type { Battle, BattlePlayer } from "@/types";
import { useInteractionReady } from "@/hooks/useInteractionReady";

const { width: SCREEN_W } = Dimensions.get("window");
// Each player thumb: half the modal width minus padding and VS column
const THUMB_W = Math.floor((SCREEN_W - SPACING.xl * 2 - 60) / 2);
const THUMB_H = Math.round(THUMB_W * 1.3);

interface Props {
  visible: boolean;
  battle: Battle | null;
  userVote: "A" | "B" | null;
  onVote: (battleId: string, side: "A" | "B") => void;
  onClose: () => void;
  currentUserId?: string | null;
  onAccept?: (battleId: string) => void;
  onSkip?: (battleId: string) => void;
}

// ── Player thumbnail column ───────────────────────────────────────────────────

function PlayerThumb({
  player,
  side,
  userVote,
  canVote,
  isWinner,
  isCompleted,
  battleId,
  onVote,
  currentUserId,
  autoPlayMedia,
}: {
  player: BattlePlayer | null;
  side: "A" | "B";
  userVote: "A" | "B" | null;
  canVote: boolean;
  isWinner: boolean;
  isCompleted: boolean;
  battleId: string;
  onVote: (battleId: string, side: "A" | "B") => void;
  currentUserId?: string | null;
  autoPlayMedia: boolean;
}) {
  const router = useRouter();
  const voted = userVote === side;
  const [isPlaying, setIsPlaying] = useState(autoPlayMedia);
  const normalizedMediaUrl = useMemo(
    () => normalizeFirebaseStorageUrl(player?.mediaUrl),
    [player?.mediaUrl]
  );
  const isVideo = isVideoMedia(normalizedMediaUrl || player?.mediaUrl, player?.mediaType);

  useEffect(() => {
    setIsPlaying(autoPlayMedia);
  }, [autoPlayMedia, battleId, player?.mediaUrl]);

  function goProfile() {
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

  return (
    <View style={detail.thumbCol}>
      {/* Player name */}
      <Pressable
        onPress={goProfile}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        accessibilityRole="link"
        accessibilityLabel={player ? `View ${player.username}'s profile` : undefined}
      >
        <Text style={detail.playerName} numberOfLines={1}>
          {player?.username ?? (side === "A" ? "Player A" : "Challenger")}
        </Text>
        {player && (
          <Text style={detail.playerHandle} numberOfLines={1}>
            {toHandle(player.username)}
          </Text>
        )}
      </Pressable>

      {/* Media thumb */}
      {player ? (
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
          style={[detail.thumbWrap, { width: THUMB_W, height: THUMB_H }]}
        >
          <BattleMedia
            uri={player.mediaUrl || null}
            mediaType={player.mediaType}
            playing={isVideo && isPlaying}
            style={{ width: THUMB_W, height: THUMB_H }}
            context="BattleDetail"
          />
          {/* Voted overlay */}
          {voted && (
            <View style={detail.overlay} accessible accessibilityLabel="Your vote">
              <Feather name="check-circle" size={40} color={COLORS.accent} />
            </View>
          )}
          {/* Winner banner — gold */}
          {isWinner && (
            <View style={detail.winnerBadge}>
              <MaterialCommunityIcons name="trophy" size={12} color={COLORS.warning} />
              <Text style={detail.winnerText}>BATTLE WINNER</Text>
            </View>
          )}
          {/* Tap to vote hint */}
          {canVote && !voted && (
            <View style={detail.tapHint}>
              <Text style={detail.tapHintText}>Tap to vote</Text>
            </View>
          )}
        </Pressable>
      ) : (
        <View style={[detail.thumbWrap, detail.openSlot, { width: THUMB_W, height: THUMB_H }]}>
          <Feather name="clock" size={22} color={COLORS.accent} />
          <Text style={detail.openSlotText}>Waiting for{"\n"}challenger</Text>
        </View>
      )}

      {/* Avatar */}
      {player && (
        <Pressable onPress={goProfile} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <AvatarImage uri={player.avatar || null} username={player.username || "?"} size={24} />
        </Pressable>
      )}
    </View>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

export default function BattleDetailModal({
  visible,
  battle,
  userVote,
  onVote,
  onClose,
  currentUserId,
  onAccept,
  onSkip,
}: Props) {
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  // Duplicate-tap guard: once a vote button is pressed, both buttons lock
  // until the vote resolves (userVote changes) or a different battle opens.
  // If the backend rejects the vote, the parent reverts optimistic state and
  // userVote stays null — this effect then re-enables the buttons.
  const [pendingSide, setPendingSide] = useState<"A" | "B" | null>(null);
  const battleId = battle?.id ?? null;
  const mediaReady = useInteractionReady(visible, battleId);
  useEffect(() => {
    setPendingSide(null);
  }, [battleId, userVote]);

  if (!battle) return null;
  const activeBattle = battle;

  const status     = getBattleStatus(activeBattle);
  const winner     = getBattleWinner(activeBattle);
  const timeLabel  = getTimeRemainingLabel(activeBattle);
  const isCompleted = status === "completed";
  const isLive      = status === "live";
  const isOpen      = status === "open";

  const votesA = activeBattle.votesA ?? 0;
  const votesB = activeBattle.votesB ?? 0;
  const total  = votesA + votesB;
  const pctA   = total > 0 ? Math.round((votesA / total) * 100) : 50;
  const pctB   = 100 - pctA;

  const isOwner =
    !!currentUserId && (
      activeBattle.playerA?.userId === currentUserId ||
      activeBattle.playerB?.userId === currentUserId ||
      activeBattle.creatorId === currentUserId
    );

  const canVote =
    isLive && !userVote && !!currentUserId && !!activeBattle.playerB && !isOwner;

  const canAccept =
    isOpen && !activeBattle.playerB && !!currentUserId && !isOwner;

  const mySide: "A" | "B" | null =
    currentUserId && activeBattle.playerA?.userId === currentUserId ? "A" :
    currentUserId && activeBattle.playerB?.userId === currentUserId ? "B" : null;

  const winnerIsA = winner !== null && winner !== "tie" && winner === activeBattle.playerA;
  const winnerIsB = winner !== null && winner !== "tie" && winner === activeBattle.playerB;

  async function handleShare() {
    try {
      await shareBattle(activeBattle);
    } catch (err) {
      console.error("[BattleDetail] share failed:", err);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={detail.overlay2}>
        <View style={detail.sheet}>
          {/* Handle */}
          <View style={detail.handle} />

          {/* Close + share buttons */}
          <IconButton
            icon="x"
            size={32}
            accessibilityLabel="Close battle details"
            onPress={onClose}
            style={detail.closeBtn}
          />
          <IconButton
            icon="share"
            size={32}
            accessibilityLabel="Share battle"
            onPress={handleShare}
            style={detail.shareBtn}
          />

          <ScrollView
            showsVerticalScrollIndicator={false}
            // SAFE AREA: sheet rests on the screen edge — last content must
            // clear the home indicator.
            contentContainerStyle={{ paddingBottom: insets.bottom + SPACING.xl }}
          >
            {/* Status row */}
            <View style={detail.statusRow}>
              <BattleStatusBadge status={status} />
              {!!timeLabel && (
                <Text style={detail.timeLabel}>{timeLabel}</Text>
              )}
            </View>

            {/* Category */}
            {!!battle.category && (
              <Text style={detail.category}>{battle.category}</Text>
            )}

            {/* Players + VS */}
            <View style={detail.playersRow}>
              <PlayerThumb
                player={battle.playerA}
                side="A"
                userVote={userVote}
                canVote={canVote}
                isWinner={winnerIsA}
                isCompleted={isCompleted}
                battleId={battle.id}
                onVote={onVote}
                currentUserId={currentUserId}
                autoPlayMedia={isLive && mediaReady}
              />

              <View style={detail.vsCol}>
                <Text style={detail.vs}>VS</Text>
              </View>

              <PlayerThumb
                player={battle.playerB}
                side="B"
                userVote={userVote}
                canVote={canVote}
                isWinner={winnerIsB}
                isCompleted={isCompleted}
                battleId={battle.id}
                onVote={onVote}
                currentUserId={currentUserId}
                autoPlayMedia={isLive && mediaReady}
              />
            </View>

            {/* Vote bar — shown when there are players on both sides */}
            {!isOpen && (
              <View style={detail.voteBarSection}>
                <VoteBar
                  pctA={pctA}
                  pctB={pctB}
                  totalVotes={total}
                  nameA={battle.playerA?.username}
                  nameB={battle.playerB?.username}
                  height={10}
                />
              </View>
            )}

            {/* Vote buttons */}
            {(canVote || (isLive && onSkip)) && (
              <View style={detail.actionSection}>
                {canVote && (
                  <>
                    <Text style={detail.voteHint}>
                      Which highlight is stronger? Your vote decides the winner.
                    </Text>
                    <View style={detail.voteButtons}>
                      <GlowButton
                        label={`Vote ${battle.playerA?.username ?? "A"}`}
                        onPress={() => {
                          if (pendingSide) return;
                          setPendingSide("A");
                          onVote(battle.id, "A");
                        }}
                        loading={pendingSide === "A"}
                        disabled={pendingSide !== null}
                        variant="primary"
                        size="sm"
                        style={detail.voteBtn}
                        accessibilityLabel={`Vote for ${battle.playerA?.username ?? "Player A"}`}
                      />
                      <GlowButton
                        label={`Vote ${battle.playerB?.username ?? "B"}`}
                        onPress={() => {
                          if (pendingSide) return;
                          setPendingSide("B");
                          onVote(battle.id, "B");
                        }}
                        loading={pendingSide === "B"}
                        disabled={pendingSide !== null}
                        variant="secondary"
                        size="sm"
                        style={detail.voteBtn}
                        accessibilityLabel={`Vote for ${battle.playerB?.username ?? "Player B"}`}
                      />
                    </View>
                  </>
                )}
                {onSkip && (
                  <Pressable
                    onPress={() => onSkip(battle.id)}
                    style={({ pressed }) => [detail.skipBtn, pressed && { opacity: 0.7 }]}
                    hitSlop={HIT_SLOP}
                    accessibilityRole="button"
                    accessibilityLabel="Skip to next battle"
                  >
                    <Text style={detail.skipBtnText}>Skip to next battle →</Text>
                  </Pressable>
                )}
              </View>
            )}

            {/* Accept challenge */}
            {canAccept && onAccept && (
              <View style={detail.actionSection}>
                <GlowButton
                  label="Accept Challenge"
                  onPress={() => { onAccept(battle.id); onClose(); }}
                  variant="primary"
                  size="sm"
                />
              </View>
            )}

            {/* Voted confirmation */}
            {!!userVote && (
              <Text style={detail.votedMsg}>
                You voted for{" "}
                {userVote === "A"
                  ? (battle.playerA?.username ?? "Player A")
                  : (battle.playerB?.username ?? "Player B")}
              </Text>
            )}

            {/* Own-battle notice */}
            {isOwner && mySide && isLive && (
              <Text style={detail.ownMsg}>You can't vote in your own battle</Text>
            )}

            {/* Winner banner — restrained gold reveal */}
            {isCompleted && (
              <Animated.View
                entering={reducedMotion ? undefined : FadeInDown.duration(320)}
                style={detail.winnerBanner}
                accessible
                accessibilityLabel={
                  winner === "tie"
                    ? `Battle completed. Tie at ${votesA} to ${votesB} votes.`
                    : winner !== null
                    ? `Battle completed. ${(winner as BattlePlayer).username} won with ${
                        winnerIsA ? pctA : pctB
                      } percent of votes.`
                    : "Battle completed."
                }
              >
                {winner === "tie" ? (
                  <>
                    <MaterialCommunityIcons name="handshake" size={32} color={COLORS.accent} />
                    <Text style={detail.winnerBannerLabel}>It's a Tie!</Text>
                    <Text style={detail.winnerBannerSub}>
                      {votesA === 0 && votesB === 0
                        ? "No votes were cast."
                        : `${votesA} — ${votesB} votes`}
                    </Text>
                  </>
                ) : winner !== null ? (
                  <>
                    <MaterialCommunityIcons name="trophy" size={32} color={COLORS.warning} />
                    <Text style={detail.winnerBannerLabel}>
                      {(winner as BattlePlayer).username} wins!
                    </Text>
                    <Text style={detail.winnerBannerSub}>
                      {winnerIsA ? `${votesA} — ${votesB}` : `${votesB} — ${votesA}`} votes
                      {` · ${winnerIsA ? pctA : pctB}%`}
                    </Text>
                  </>
                ) : (
                  <>
                    <Feather name="check-circle" size={32} color={COLORS.accent} />
                    <Text style={detail.winnerBannerLabel}>Battle ended</Text>
                  </>
                )}
              </Animated.View>
            )}

            {/* Battle metadata */}
            <View style={detail.metaSection}>
              {!!battle.category && (
                <View style={detail.metaRow}>
                  <Text style={detail.metaLabel}>Category</Text>
                  <Text style={detail.metaValue}>{battle.category}</Text>
                </View>
              )}
              {typeof battle.durationHours === "number" && (
                <View style={detail.metaRow}>
                  <Text style={detail.metaLabel}>Duration</Text>
                  <Text style={detail.metaValue}>{battle.durationHours}h</Text>
                </View>
              )}
              {!!battle.createdAt && (
                <View style={detail.metaRow}>
                  <Text style={detail.metaLabel}>Started</Text>
                  <Text style={detail.metaValue}>{formatBattleDate(battle.createdAt)}</Text>
                </View>
              )}
              {isCompleted && !!battle.endTime && (
                <View style={detail.metaRow}>
                  <Text style={detail.metaLabel}>Ended</Text>
                  <Text style={detail.metaValue}>
                    {formatBattleDate(battle.endTime as Battle["createdAt"])}
                  </Text>
                </View>
              )}
              <View style={detail.metaRow}>
                <Text style={detail.metaLabel}>Total votes</Text>
                <Text style={detail.metaValue}>{total.toLocaleString()}</Text>
              </View>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const detail = StyleSheet.create({
  overlay2: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.md,
    maxHeight: "92%",
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.inputBorder,
    alignSelf: "center",
    marginBottom: SPACING.md,
  },
  closeBtn: {
    position: "absolute",
    top: SPACING.md,
    right: SPACING.xl,
    zIndex: 10,
  },
  shareBtn: {
    position: "absolute",
    top: SPACING.md,
    right: SPACING.xl + 40,
    zIndex: 10,
  },

  // Status
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: SPACING.xs,
    marginTop: SPACING.sm,
  },
  timeLabel: { color: COLORS.textMuted, fontSize: 12, fontWeight: FONTS.semibold },

  // Category
  category: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: FONTS.heavy,
    textAlign: "center",
    marginVertical: SPACING.sm,
  },

  // Players
  playersRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: SPACING.md,
    gap: 0,
  },
  thumbCol: {
    flex: 1,
    alignItems: "center",
    gap: 6,
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
  thumbWrap: {
    borderRadius: RADIUS.md,
    overflow: "hidden",
    backgroundColor: COLORS.surface,
    position: "relative",
  },
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
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.scrim,
    alignItems: "center",
    justifyContent: "center",
  } as const,
  winnerBadge: {
    position: "absolute",
    bottom: 6,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.scrimHeavy,
    borderRadius: RADIUS.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  winnerText: { color: COLORS.warning, fontSize: TYPE.caption, fontWeight: FONTS.heavy },
  tapHint: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.accentSoft,
    paddingVertical: 5,
    alignItems: "center",
  },
  tapHintText: { color: COLORS.accent, fontSize: TYPE.caption, fontWeight: FONTS.bold },

  // VS column
  vsCol: {
    width: 60,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: THUMB_H / 2.5,
  },
  vs: {
    color: COLORS.accent,
    fontSize: 26,
    fontWeight: FONTS.heavy,
    letterSpacing: 2,
  },

  // Vote bar
  voteBarSection: {
    marginBottom: SPACING.md,
  },

  // Actions
  actionSection: {
    marginBottom: SPACING.md,
  },
  voteHint: {
    color: COLORS.textMuted,
    fontSize: 12,
    textAlign: "center",
    marginBottom: SPACING.sm,
  },
  voteButtons: {
    flexDirection: "row",
    gap: SPACING.sm,
  },
  voteBtn: { flex: 1 },
  skipBtn: {
    alignSelf: "center",
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    marginTop: SPACING.sm,
  },
  skipBtnText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: FONTS.semibold,
  },

  // Messages
  votedMsg: {
    color: COLORS.accent,
    fontSize: 13,
    fontWeight: FONTS.semibold,
    textAlign: "center",
    marginBottom: SPACING.sm,
  },
  ownMsg: {
    color: COLORS.textMuted,
    fontSize: 12,
    textAlign: "center",
    fontStyle: "italic",
    marginBottom: SPACING.sm,
  },

  // Winner banner
  winnerBanner: {
    backgroundColor: COLORS.warningFaint,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.warningBorder,
    padding: SPACING.lg,
    alignItems: "center",
    gap: SPACING.xs,
    marginBottom: SPACING.lg,
  },
  winnerBannerLabel: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: FONTS.heavy,
    textAlign: "center",
  },
  winnerBannerSub: {
    color: COLORS.textMuted,
    fontSize: 13,
    textAlign: "center",
  },

  // Metadata
  metaSection: {
    borderTopWidth: 1,
    borderTopColor: COLORS.cardBorder,
    paddingTop: SPACING.md,
    marginBottom: SPACING.lg,
    gap: SPACING.sm,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  metaLabel: {
    color: COLORS.textMuted,
    fontSize: TYPE.small,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  metaValue: {
    color: COLORS.textSecondary,
    fontSize: TYPE.footnote,
    fontWeight: FONTS.semibold,
  },
});
