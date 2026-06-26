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
import { COLORS, FONTS, SPACING, RADIUS } from "@/constants/theme";
import AvatarImage from "./AvatarImage";
import GlowButton from "./GlowButton";
import BattleMedia from "./BattleMedia";
import { openAthleteProfile } from "@/utils/navigation";
import { shareBattle } from "@/utils/shareBattle";
import { isVideoMedia, normalizeFirebaseStorageUrl } from "@/utils/media";
import {
  getBattleStatus,
  getBattleWinner,
  getTimeRemainingLabel,
} from "@/hooks/useBattles";
import type { Battle, BattlePlayer } from "@/types";

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

// ── Status label / colour helpers ────────────────────────────────────────────

function statusLabel(status: "open" | "live" | "completed"): string {
  if (status === "live")      return "🏆 LIVE BATTLE";
  if (status === "completed") return "✅ COMPLETED";
  return "🔓 OPEN CHALLENGE";
}

function statusColor(status: "open" | "live" | "completed"): string {
  if (status === "live")      return COLORS.live;
  if (status === "completed") return COLORS.accent;
  return COLORS.textSecondary;
}

function statusBg(status: "open" | "live" | "completed"): string {
  if (status === "live")      return COLORS.liveFaint;
  if (status === "completed") return COLORS.accentFaint;
  return COLORS.surface;
}

function statusBorder(status: "open" | "live" | "completed"): string {
  if (status === "live")      return COLORS.live;
  if (status === "completed") return COLORS.accent;
  return COLORS.inputBorder;
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
      <Pressable onPress={goProfile} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
        <Text style={detail.playerName} numberOfLines={1}>
          {player?.username ?? (side === "A" ? "Player A" : "Challenger")}
        </Text>
        {player && (
          <Text style={detail.playerHandle} numberOfLines={1}>
            @{player.username.toLowerCase().replace(/\s+/g, ".")}
          </Text>
        )}
      </Pressable>

      {/* Media thumb */}
      {player ? (
        <Pressable
          onPress={isVideo || canVote ? handleThumbPress : undefined}
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
            <View style={detail.overlay}>
              <Text style={detail.votedCheck}>✓</Text>
            </View>
          )}
          {/* Winner crown */}
          {isWinner && (
            <View style={detail.winnerBadge}>
              <Text style={detail.winnerText}>👑 WINNER</Text>
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
          <Text style={detail.openSlotIcon}>⏳</Text>
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

  __DEV__ && console.log("[battleDetail] opened —", {
    battleId: battle.id,
    status,
    category: battle.category,
    isOwner,
    canVote,
    userVote,
  });

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={detail.overlay2}>
        <View style={detail.sheet}>
          {/* Handle */}
          <View style={detail.handle} />

          {/* Close button */}
          <Pressable onPress={onClose} style={detail.closeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={detail.closeIcon}>✕</Text>
          </Pressable>

          <Pressable onPress={handleShare} style={detail.shareBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={detail.shareIcon}>↗</Text>
          </Pressable>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: SPACING.xxxl }}>
            {/* Status row */}
            <View style={detail.statusRow}>
              <View style={[detail.statusBadge, {
                backgroundColor: statusBg(status),
                borderColor: statusBorder(status),
              }]}>
                <Text style={[detail.statusText, { color: statusColor(status) }]}>
                  {statusLabel(status)}
                </Text>
              </View>
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
                autoPlayMedia={isLive}
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
                autoPlayMedia={isLive}
              />
            </View>

            {/* Vote bar — shown when there are players on both sides */}
            {!isOpen && (
              <View style={detail.voteBarSection}>
                <View style={detail.voteBarLabels}>
                  <Text style={detail.pctA}>{pctA}%</Text>
                  <Text style={detail.voteTotal}>{total.toLocaleString()} votes</Text>
                  <Text style={detail.pctB}>{pctB}%</Text>
                </View>
                <View style={detail.voteBarTrack}>
                  <View style={[detail.voteBarA, { flex: pctA }]} />
                  <View style={[detail.voteBarB, { flex: pctB }]} />
                </View>
              </View>
            )}

            {/* Vote buttons */}
            {(canVote || (isLive && onSkip)) && (
              <View style={detail.actionSection}>
                {canVote && (
                  <View style={detail.voteButtons}>
                    <GlowButton
                      label={`Vote ${battle.playerA?.username ?? "A"}`}
                      onPress={() => { onVote(battle.id, "A"); }}
                      variant="primary"
                      size="sm"
                      style={detail.voteBtn}
                    />
                    <GlowButton
                      label={`Vote ${battle.playerB?.username ?? "B"}`}
                      onPress={() => { onVote(battle.id, "B"); }}
                      variant="secondary"
                      size="sm"
                      style={detail.voteBtn}
                    />
                  </View>
                )}
                {onSkip && (
                  <Pressable
                    onPress={() => onSkip(battle.id)}
                    style={detail.skipBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
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

            {/* Winner banner */}
            {isCompleted && (
              <View style={detail.winnerBanner}>
                {winner === "tie" ? (
                  <>
                    <Text style={detail.winnerBannerIcon}>🤝</Text>
                    <Text style={detail.winnerBannerLabel}>It's a Tie!</Text>
                    <Text style={detail.winnerBannerSub}>
                      {votesA === 0 && votesB === 0
                        ? "No votes were cast."
                        : `${votesA} — ${votesB} votes`}
                    </Text>
                  </>
                ) : winner !== null ? (
                  <>
                    <Text style={detail.winnerBannerIcon}>🏆</Text>
                    <Text style={detail.winnerBannerLabel}>
                      {(winner as BattlePlayer).username} wins!
                    </Text>
                    <Text style={detail.winnerBannerSub}>
                      {winnerIsA ? `${votesA} — ${votesB}` : `${votesB} — ${votesA}`} votes
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={detail.winnerBannerIcon}>✅</Text>
                    <Text style={detail.winnerBannerLabel}>Battle ended</Text>
                  </>
                )}
              </View>
            )}
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
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  closeIcon: { color: COLORS.textSecondary, fontSize: 14, fontWeight: FONTS.heavy },
  shareBtn: {
    position: "absolute",
    top: SPACING.md,
    right: SPACING.xl + 40,
    zIndex: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  shareIcon: { color: COLORS.textSecondary, fontSize: 15, fontWeight: FONTS.heavy },

  // Status
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: SPACING.xs,
    marginTop: SPACING.sm,
  },
  statusBadge: {
    borderRadius: RADIUS.xs,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
  },
  statusText: { fontSize: 11, fontWeight: FONTS.heavy, letterSpacing: 0.5 },
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
  openSlotIcon: { color: COLORS.accent, fontSize: 22 },
  openSlotText: { color: COLORS.textMuted, fontSize: 11, textAlign: "center" },

  // Overlays
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  } as const,
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
  tapHint: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(166,255,0,0.18)",
    paddingVertical: 5,
    alignItems: "center",
  },
  tapHintText: { color: COLORS.accent, fontSize: 11, fontWeight: FONTS.bold },

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
    gap: 6,
    marginBottom: SPACING.md,
  },
  voteBarLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  pctA: { color: COLORS.accent, fontSize: 15, fontWeight: FONTS.heavy },
  pctB: { color: COLORS.accent2, fontSize: 15, fontWeight: FONTS.heavy },
  voteTotal: { color: COLORS.textMuted, fontSize: 12 },
  voteBarTrack: {
    flexDirection: "row",
    height: 10,
    borderRadius: RADIUS.full,
    overflow: "hidden",
    backgroundColor: COLORS.surface,
  },
  voteBarA: { backgroundColor: COLORS.accent },
  voteBarB: { backgroundColor: COLORS.accent2 },

  // Actions
  actionSection: {
    marginBottom: SPACING.md,
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
    backgroundColor: COLORS.accentFaint,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.accent,
    padding: SPACING.lg,
    alignItems: "center",
    gap: SPACING.xs,
    marginBottom: SPACING.lg,
  },
  winnerBannerIcon: { fontSize: 32 },
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
});
