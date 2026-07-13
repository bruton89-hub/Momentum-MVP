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
  /** Feed scroll offset — drives the subtle avatar collapse. */
  scrollY?: SharedValue<number>;
}

/**
 * Premium athlete profile header — large ringed avatar, athlete-first identity
 * hierarchy, real-data badges, summary card, and the primary action row.
 * Every identity field is optional; missing data simply doesn't render.
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

  // Subtle scroll-linked avatar scale — pure UI-thread interpolation.
  const avatarStyle = useAnimatedStyle(() => {
    if (reducedMotion) return {};
    const scale = interpolate(scroll.value, [0, 150], [1, 0.86], Extrapolation.CLAMP);
    return { transform: [{ scale }] };
  });

  const handle = toHandle(profile.username);
  const avatarUri = profile.avatarUrl || profile.avatar;

  // ── Identity lines — render only what exists, never blank labels ────────────
  const sportLine = [
    profile.sport || profile.athleteType,
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

  // ── Summary stats — omit anything without real data ─────────────────────────
  const stats = useMemo(() => {
    const items: StatItem[] = [
      { label: "Posts", value: postsCount },
      { label: "Battles", value: battlesCount },
      { label: "Wins", value: profile.wins },
      { label: "Losses", value: profile.losses },
    ];
    const decided = profile.wins + profile.losses;
    if (decided > 0) {
      items.push({
        label: "Win %",
        value: `${Math.round((profile.wins / decided) * 100)}%`,
      });
    }
    if (typeof profile.momentumScore === "number") {
      items.push({ label: "Momentum", value: profile.momentumScore });
    }
    return items;
  }, [postsCount, battlesCount, profile.wins, profile.losses, profile.momentumScore]);

  const entrance = (delay: number) =>
    reducedMotion ? undefined : FadeIn.duration(280).delay(delay);

  return (
    <View style={styles.wrap}>
      {/* ── Identity ─────────────────────────────────────────────────────────── */}
      <View style={styles.identity}>
        <Animated.View style={avatarStyle}>
          <View style={[styles.avatarRing, profile.verified && styles.avatarRingVerified]}>
            <AvatarImage uri={avatarUri} username={profile.username} size={96} />
          </View>
        </Animated.View>

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
        {programLine ? <Text style={styles.programLine}>{programLine}</Text> : null}
        {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
      </View>

      {/* ── Badges ───────────────────────────────────────────────────────────── */}
      {badges.length > 0 && (
        <Animated.View entering={entrance(60)} style={styles.badgeRow}>
          {badges.map((variant) => (
            <SportBadge key={variant} variant={variant} />
          ))}
        </Animated.View>
      )}

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

      {/* ── Athlete summary card ─────────────────────────────────────────────── */}
      <Animated.View entering={entrance(120)} style={styles.summaryCard}>
        {stats.map((stat) => (
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
    alignItems: "center",
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.sm,
    gap: 3,
  },
  avatarRing: {
    width: 108,
    height: 108,
    borderRadius: 54,
    borderWidth: 2.5,
    borderColor: COLORS.cardBorder,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: SPACING.md,
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
    marginTop: SPACING.xs,
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
    textAlign: "center",
    marginTop: SPACING.sm,
  },

  // ── Badges ───────────────────────────────────────────────────────────────────
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
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

  // ── Summary card ─────────────────────────────────────────────────────────────
  summaryCard: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.surfaceRaised,
  },
  stat: {
    width: "25%",
    alignItems: "center",
    paddingVertical: SPACING.sm,
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
});

