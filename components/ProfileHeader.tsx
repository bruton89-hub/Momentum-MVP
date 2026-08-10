import React, { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import Animated, {
  FadeIn,
  interpolate,
  Extrapolation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  SharedValue,
} from "react-native-reanimated";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { COLORS, SPACING, RADIUS, FONTS, TYPE } from "@/constants/theme";
import AvatarImage from "./AvatarImage";
import GlowButton from "./GlowButton";
import IconButton from "./IconButton";
import SportBadge, { SportBadgeVariant } from "./SportBadge";
import ProfileBanner from "./ProfileBanner";
import { toHandle } from "@/utils/format";
import type { UserProfile } from "@/types";

interface StatItem {
  label: string;
  value: string | number;
}

interface Props {
  profile: UserProfile;
  /** Live count from the loaded posts array (profile.posts is stale by design). */
  postsCount: number;
  /** Count of battles involving this athlete (already loaded — no new queries). */
  battlesCount: number;
  isOwn: boolean;
  /** True when any loaded post crosses the documented trending threshold. */
  hasTrendingPost?: boolean;
  isFollowing?: boolean;
  onFollow?: () => void;
  onChallenge?: () => void;
  onMessage?: () => void;
  onEdit?: () => void;
  onShare?: () => void;
  /** Feed scroll offset — drives banner parallax and the avatar collapse. */
  scrollY?: SharedValue<number>;
}

/** Avatar diameter, and how far it overlaps the banner's bottom edge. */
const AVATAR_SIZE = 96;
const AVATAR_RING = 4;
const AVATAR_OVERLAP = 46;

/**
 * Premium athlete profile header — sport-coded banner, overlapping ringed
 * avatar, athlete-first identity hierarchy, real-data badges, a record card,
 * and the primary action row.
 *
 * Every identity field is optional; missing data simply doesn't render, so a
 * brand-new athlete gets a clean header rather than a grid of blank labels.
 */
export default function ProfileHeader({
  profile,
  postsCount,
  battlesCount,
  isOwn,
  hasTrendingPost = false,
  isFollowing = false,
  onFollow,
  onChallenge,
  onMessage,
  onEdit,
  onShare,
  scrollY,
}: Props) {
  const reducedMotion = useReducedMotion();
  const fallbackScroll = useSharedValue(0);
  const scroll = scrollY ?? fallbackScroll;

  // Subtle scroll-linked avatar collapse — pure UI-thread interpolation.
  // Anchored bottom-left so it shrinks toward the name rather than drifting.
  const avatarStyle = useAnimatedStyle(() => {
    if (reducedMotion) return {};
    const scale = interpolate(scroll.value, [0, 150], [1, 0.82], Extrapolation.CLAMP);
    return { transform: [{ scale }] };
  });

  const handle = toHandle(profile.username);
  const avatarUri = profile.avatarUrl || profile.avatar;
  const sport = profile.sport || profile.athleteType;

  // ── Identity lines — render only what exists, never blank labels ────────────
  const sportLine = [
    sport,
    profile.position,
    profile.gradYear ? `Class of ${profile.gradYear}` : undefined,
  ]
    .filter(Boolean)
    .join("  ·  ");

  const homeBase = [profile.city, profile.state].filter(Boolean).join(", ");
  const programLine = [profile.school || profile.teamName, homeBase]
    .filter(Boolean)
    .join("  ·  ");

  // ── Badges — strictly real data ──────────────────────────────────────────────
  const badges = useMemo(() => {
    const list: SportBadgeVariant[] = [];
    if (profile.verified) list.push("verified");
    if (profile.coachVerified) list.push("coach");
    if (profile.tournamentChampion) list.push("champion");
    if (profile.topRanked) list.push("topRanked");
    if (profile.wins > 0) list.push("winner");
    if (hasTrendingPost) list.push("trending");
    return list;
  }, [
    profile.verified,
    profile.coachVerified,
    profile.tournamentChampion,
    profile.topRanked,
    profile.wins,
    hasTrendingPost,
  ]);

  // ── Counts — exactly four, so the row never wraps ───────────────────────────
  // Win % and Momentum used to sit in this same wrapping 25%-width row, which
  // pushed a fifth cell onto a second line and left it stranded against the
  // left edge. They're derived/ranking figures rather than counts, so they get
  // their own strip below where they can be labelled properly.
  const counts = useMemo<StatItem[]>(
    () => [
      { label: "Posts", value: postsCount },
      { label: "Battles", value: battlesCount },
      { label: "Wins", value: profile.wins },
      { label: "Losses", value: profile.losses },
    ],
    [postsCount, battlesCount, profile.wins, profile.losses]
  );

  const decided = profile.wins + profile.losses;
  const winRate = decided > 0 ? Math.round((profile.wins / decided) * 100) : null;
  const hasRecordStrip = winRate !== null || typeof profile.momentumScore === "number";

  const entrance = (delay: number) =>
    reducedMotion ? undefined : FadeIn.duration(280).delay(delay);

  return (
    <View style={styles.wrap}>
      <ProfileBanner
        bannerUrl={profile.bannerUrl}
        sport={sport}
        scrollY={scrollY}
      />

      {/* ── Identity — pulled up over the banner's lower edge ────────────────── */}
      <View style={styles.identity}>
        <View style={styles.avatarRow}>
          <Animated.View style={avatarStyle}>
            <View
              style={[
                styles.avatarRing,
                profile.verified && styles.avatarRingVerified,
              ]}
            >
              <AvatarImage
                uri={avatarUri}
                username={profile.username}
                size={AVATAR_SIZE}
              />
            </View>
          </Animated.View>

          {/* Badges sit beside the avatar, in the space the banner opened up,
              instead of consuming a full row of vertical rhythm. */}
          {badges.length > 0 && (
            <Animated.View entering={entrance(60)} style={styles.badgeRow}>
              {badges.map((variant) => (
                <SportBadge key={variant} variant={variant} />
              ))}
            </Animated.View>
          )}
        </View>

        <View style={styles.nameRow}>
          <Text style={styles.name} accessibilityRole="header" numberOfLines={1}>
            {profile.username}
          </Text>
          {profile.verified && (
            <MaterialCommunityIcons
              name="check-decagram"
              size={20}
              color={COLORS.accent}
              accessibilityLabel="Verified athlete"
            />
          )}
        </View>
        <Text style={styles.handle}>{handle}</Text>

        {sportLine ? <Text style={styles.sportLine}>{sportLine}</Text> : null}
        {programLine ? (
          <Text style={styles.programLine}>{programLine}</Text>
        ) : null}
        {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
      </View>

      {/* ── Primary actions ──────────────────────────────────────────────────── */}
      <View style={styles.actionRow}>
        {isOwn ? (
          <>
            {onEdit && (
              <GlowButton
                label="Edit Profile"
                onPress={onEdit}
                variant="secondary"
                size="sm"
                style={styles.actionFlex}
                accessibilityLabel="Edit your profile"
              />
            )}
            {onShare && (
              <GlowButton
                label="Share Profile"
                onPress={onShare}
                variant="ghost"
                size="sm"
                style={styles.actionFlex}
                accessibilityLabel="Share your profile"
              />
            )}
          </>
        ) : (
          <>
            {onFollow && (
              <GlowButton
                label={isFollowing ? "Following" : "Follow"}
                onPress={onFollow}
                variant={isFollowing ? "ghost" : "secondary"}
                size="sm"
                style={styles.actionFlex}
                accessibilityLabel={
                  isFollowing
                    ? `Unfollow ${profile.username}`
                    : `Follow ${profile.username}`
                }
              />
            )}
            {onChallenge && (
              <GlowButton
                label="CHALLENGE"
                onPress={onChallenge}
                variant="primary"
                size="sm"
                style={styles.actionHero}
                textStyle={styles.challengeText}
                accessibilityLabel={`Challenge ${profile.username} to a battle`}
              />
            )}
            {onMessage && (
              <IconButton
                icon="message-circle"
                size={40}
                color={COLORS.textSecondary}
                accessibilityLabel={`Message ${profile.username} — coming soon`}
                onPress={onMessage}
              />
            )}
          </>
        )}
      </View>

      {/* ── Record card ──────────────────────────────────────────────────────── */}
      <Animated.View entering={entrance(120)} style={styles.summaryCard}>
        <View style={styles.countRow}>
          {counts.map((stat) => (
            <View
              key={stat.label}
              style={styles.stat}
              accessible
              accessibilityLabel={`${stat.value} ${stat.label}`}
            >
              <Text style={styles.statValue}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>

        {hasRecordStrip && (
          <View style={styles.recordStrip}>
            {winRate !== null && (
              <View
                style={styles.recordItem}
                accessible
                accessibilityLabel={`Win rate ${winRate} percent, from ${decided} decided battles`}
              >
                <MaterialCommunityIcons
                  name="trophy-outline"
                  size={13}
                  color={COLORS.accent}
                />
                <Text style={styles.recordValue}>{winRate}%</Text>
                <Text style={styles.recordLabel}>win rate</Text>
              </View>
            )}
            {typeof profile.momentumScore === "number" && (
              <View
                style={styles.recordItem}
                accessible
                accessibilityLabel={`Momentum score ${profile.momentumScore}`}
              >
                <MaterialCommunityIcons
                  name="lightning-bolt-outline"
                  size={13}
                  color={COLORS.accent}
                />
                <Text style={styles.recordValue}>{profile.momentumScore}</Text>
                <Text style={styles.recordLabel}>momentum</Text>
              </View>
            )}
          </View>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingBottom: SPACING.md,
    backgroundColor: COLORS.background,
  },

  // ── Identity ─────────────────────────────────────────────────────────────────
  identity: {
    paddingHorizontal: SPACING.lg,
    // Lifts the avatar so it straddles the banner's bottom edge.
    marginTop: -AVATAR_OVERLAP,
    gap: 3,
  },
  avatarRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginBottom: SPACING.md,
  },
  avatarRing: {
    width: AVATAR_SIZE + AVATAR_RING * 2,
    height: AVATAR_SIZE + AVATAR_RING * 2,
    borderRadius: (AVATAR_SIZE + AVATAR_RING * 2) / 2,
    borderWidth: AVATAR_RING,
    // Ring is the page background, not a grey line — it reads as the avatar
    // punching a hole through the banner rather than sitting on top of it.
    borderColor: COLORS.background,
    backgroundColor: COLORS.background,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarRingVerified: {
    borderColor: COLORS.accent,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: "100%",
  },
  name: {
    color: COLORS.textPrimary,
    fontSize: TYPE.hero,
    lineHeight: 34,
    fontWeight: FONTS.heavy,
    letterSpacing: 0.3,
    flexShrink: 1,
  },
  handle: {
    color: COLORS.textHandle,
    fontSize: TYPE.body,
    fontWeight: FONTS.medium,
  },
  sportLine: {
    color: COLORS.textPrimary,
    fontSize: TYPE.footnote,
    fontWeight: FONTS.bold,
    letterSpacing: 0.4,
    marginTop: SPACING.sm,
  },
  programLine: {
    color: COLORS.textSecondary,
    fontSize: TYPE.small,
    fontWeight: FONTS.medium,
    letterSpacing: 0.2,
  },
  bio: {
    color: COLORS.textSecondary,
    fontSize: TYPE.footnote,
    lineHeight: 19,
    marginTop: SPACING.sm,
  },

  // ── Badges ───────────────────────────────────────────────────────────────────
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 6,
    flexShrink: 1,
    paddingLeft: SPACING.md,
    // Nudged down so badges align with the avatar's lower half rather than
    // colliding with the banner artwork above it.
    paddingBottom: SPACING.xs,
  },

  // ── Actions ──────────────────────────────────────────────────────────────────
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
  },
  actionFlex: { flex: 1 },
  actionHero: { flex: 1.35 },
  challengeText: { letterSpacing: 1 },

  // ── Record card ──────────────────────────────────────────────────────────────
  summaryCard: {
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.surfaceRaised,
    overflow: "hidden",
  },
  countRow: {
    flexDirection: "row",
    paddingVertical: SPACING.md,
  },
  stat: {
    flex: 1,
    alignItems: "center",
    paddingVertical: SPACING.xs,
  },
  statValue: {
    color: COLORS.textPrimary,
    fontSize: TYPE.title3,
    fontWeight: FONTS.heavy,
  },
  statLabel: {
    color: COLORS.textMuted,
    fontSize: TYPE.micro,
    marginTop: 2,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  recordStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.xl,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.cardBorder,
    backgroundColor: COLORS.surface,
  },
  recordItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  recordValue: {
    color: COLORS.textPrimary,
    fontSize: TYPE.footnote,
    fontWeight: FONTS.heavy,
  },
  recordLabel: {
    color: COLORS.textMuted,
    fontSize: TYPE.micro,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
});
