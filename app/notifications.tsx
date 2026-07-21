import React, { memo, useCallback, useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  RefreshControl,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import Animated, {
  FadeIn,
  useSharedValue,
  useAnimatedStyle,
  useReducedMotion,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
  cancelAnimation,
} from "react-native-reanimated";
import { COLORS, SPACING, RADIUS, FONTS, TYPE, HIT_SLOP } from "@/constants/theme";
import AvatarImage from "@/components/AvatarImage";
import IconButton from "@/components/IconButton";
import EmptyState from "@/components/EmptyState";
import { useAuthStore } from "@/store/authStore";
import { useNotifications } from "@/hooks/useNotifications";
import { openAthleteProfile } from "@/utils/navigation";
import { formatRelativeTime } from "@/utils/format";
import type { MomentumNotification, NotificationType } from "@/types";
import { useInteractionReady } from "@/hooks/useInteractionReady";

// ─── Per-type presentation ────────────────────────────────────────────────────

const TYPE_ICON: Record<
  NotificationType,
  { icon: React.ReactNode; a11y: string }
> = {
  follow: {
    icon: <Feather name="user-plus" size={14} color={COLORS.accent} />,
    a11y: "New follower",
  },
  comment: {
    icon: <Feather name="message-circle" size={14} color={COLORS.accent} />,
    a11y: "New comment",
  },
  challenge_received: {
    icon: <MaterialCommunityIcons name="sword-cross" size={14} color={COLORS.accent} />,
    a11y: "Challenge received",
  },
  challenge_accepted: {
    icon: <MaterialCommunityIcons name="sword-cross" size={14} color={COLORS.accent2} />,
    a11y: "Challenge accepted",
  },
  battle_completed: {
    icon: <Feather name="flag" size={14} color={COLORS.textSecondary} />,
    a11y: "Battle completed",
  },
  battle_won: {
    icon: <MaterialCommunityIcons name="trophy" size={14} color={COLORS.warning} />,
    a11y: "Battle won",
  },
};

function messageFor(n: MomentumNotification): { pre: string; name: string; post: string } {
  switch (n.type) {
    case "follow":
      return { pre: "", name: n.subjectUsername, post: " started following you." };
    case "comment":
      return {
        pre: "",
        name: n.subjectUsername,
        post: ` commented: “${n.preview ?? ""}”`,
      };
    case "challenge_received":
      return { pre: "", name: n.subjectUsername, post: " challenged you to a battle." };
    case "challenge_accepted":
      return {
        pre: "",
        name: n.subjectUsername,
        post: " accepted your challenge — the battle is live.",
      };
    case "battle_completed":
      return { pre: "Your battle against ", name: n.subjectUsername, post: " has ended." };
    case "battle_won":
      return { pre: "You won your battle against ", name: n.subjectUsername, post: "! 🏆" };
  }
}

// ─── Row (memoized — list re-renders only touch changed rows) ─────────────────

const NotificationRow = memo(function NotificationRow({
  notification,
  onPress,
  reducedMotion,
}: {
  notification: MomentumNotification;
  onPress: (n: MomentumNotification) => void;
  reducedMotion: boolean;
}) {
  const msg = messageFor(notification);
  const age = formatRelativeTime(notification.createdAt);
  const typeMeta = TYPE_ICON[notification.type];

  return (
    <Animated.View entering={reducedMotion ? undefined : FadeIn.duration(150)}>
      <Pressable
        onPress={() => onPress(notification)}
        accessibilityRole="button"
        accessibilityLabel={`${typeMeta.a11y}. ${msg.pre}${msg.name}${msg.post}${
          age ? ` ${age} ago.` : ""
        }${notification.read ? "" : " Unread."}`}
        accessibilityState={{ selected: !notification.read }}
        style={({ pressed }) => [
          styles.row,
          !notification.read && styles.rowUnread,
          pressed && { opacity: 0.8 },
        ]}
      >
        <View style={styles.avatarWrap}>
          <AvatarImage
            uri={notification.subjectAvatar || null}
            username={notification.subjectUsername}
            size={40}
          />
          <View style={styles.typeBadge}>{typeMeta.icon}</View>
        </View>
        <View style={styles.body}>
          <Text style={styles.message}>
            {msg.pre ? <Text>{msg.pre}</Text> : null}
            <Text style={styles.name}>{msg.name}</Text>
            <Text>{msg.post}</Text>
          </Text>
          {!!age && <Text style={styles.time}>{age}</Text>}
        </View>
        {!notification.read && <View style={styles.unreadDot} accessibilityElementsHidden />}
      </Pressable>
    </Animated.View>
  );
});

// ─── Layout-stable skeleton (one shared UI-thread pulse) ─────────────────────

function NotificationSkeleton() {
  const pulse = useSharedValue(0.45);
  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 650, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.45, { duration: 650, easing: Easing.inOut(Easing.quad) })
      ),
      -1
    );
    return () => cancelAnimation(pulse);
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <Animated.View
      style={pulseStyle}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading notifications"
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={styles.row}>
          <View style={styles.skelAvatar} />
          <View style={styles.body}>
            <View style={[styles.skelLine, { width: "78%" }]} />
            <View style={[styles.skelLine, { width: "26%", marginTop: 8 }]} />
          </View>
        </View>
      ))}
    </Animated.View>
  );
}

const keyExtractor = (item: MomentumNotification) => item.id;

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function NotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const userId = useAuthStore((s) => s.userId);
  const contentReady = useInteractionReady(!!userId, userId);
  const {
    notifications,
    unreadCount,
    hasMore,
    loading,
    refreshing,
    error,
    refresh,
    loadMore,
    markRead,
    markAllRead,
  } = useNotifications(userId, contentReady);

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.navigate("/(tabs)" as never);
  }

  // Deep link per type, reusing existing navigation. Mark read on open.
  const handleOpen = useCallback(
    (n: MomentumNotification) => {
      if (!n.read) markRead(n.id);
      switch (n.type) {
        case "follow":
          openAthleteProfile(router, n.actorId, userId);
          return;
        case "comment":
          // The commented post is the recipient's own — their profile grid
          // is the existing route to open it.
          router.push("/(tabs)/profile" as never);
          return;
        default:
          // All battle events land on the Battles tab.
          router.push("/battles" as never);
      }
    },
    [markRead, router, userId]
  );

  const renderItem = useCallback(
    ({ item }: { item: MomentumNotification }) => (
      <NotificationRow
        notification={item}
        onPress={handleOpen}
        reducedMotion={reducedMotion}
      />
    ),
    [handleOpen, reducedMotion]
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <IconButton
          icon="chevron-left"
          accessibilityLabel="Go back"
          onPress={goBack}
          color={COLORS.textPrimary}
        />
        <Text style={styles.title} accessibilityRole="header">
          Notifications
        </Text>
        <Pressable
          onPress={markAllRead}
          disabled={unreadCount === 0}
          hitSlop={HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel="Mark all notifications read"
          accessibilityState={{ disabled: unreadCount === 0 }}
          style={({ pressed }) => [pressed && { opacity: 0.7 }]}
        >
          <Text
            style={[styles.markAll, unreadCount === 0 && styles.markAllDisabled]}
          >
            Mark all read
          </Text>
        </Pressable>
      </View>

      {/* Load error — keep any cached rows visible */}
      {error && (
        <View style={styles.errorBanner} accessibilityRole="alert">
          <Feather name="alert-triangle" size={13} color={COLORS.warning} />
          <Text style={styles.errorText}>Couldn't refresh notifications.</Text>
          <Pressable
            onPress={refresh}
            hitSlop={HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel="Retry loading notifications"
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}

      {(!contentReady || loading) && notifications.length === 0 ? (
        <NotificationSkeleton />
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          onEndReached={hasMore ? loadMore : undefined}
          onEndReachedThreshold={0.4}
          initialNumToRender={12}
          maxToRenderPerBatch={8}
          updateCellsBatchingPeriod={50}
          windowSize={7}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={COLORS.accent}
              colors={[COLORS.accent]}
            />
          }
          contentContainerStyle={
            // SAFE AREA: stack screen with no tab bar — the last row must
            // clear the home indicator.
            notifications.length === 0
              ? { flex: 1, paddingBottom: insets.bottom }
              : { paddingBottom: insets.bottom + SPACING.xl }
          }
          ListEmptyComponent={
            <EmptyState
              icon="🔔"
              title="No notifications yet"
              subtitle="Follows, comments, and battle updates will land here."
              actionLabel="Browse highlights"
              onAction={() => router.navigate("/(tabs)" as never)}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
    gap: SPACING.sm,
  },
  title: {
    flex: 1,
    color: COLORS.textPrimary,
    fontSize: TYPE.headline,
    fontWeight: FONTS.heavy,
    letterSpacing: 0.2,
    textAlign: "center",
  },
  markAll: {
    color: COLORS.accent,
    fontSize: TYPE.footnote,
    fontWeight: FONTS.bold,
  },
  markAllDisabled: { color: COLORS.textMuted },

  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.warningBorder,
    backgroundColor: COLORS.warningFaint,
  },
  errorText: { flex: 1, color: COLORS.textSecondary, fontSize: TYPE.small },
  retryText: { color: COLORS.accent, fontSize: TYPE.small, fontWeight: FONTS.bold },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    minHeight: 64,
  },
  rowUnread: { backgroundColor: COLORS.surfaceRaised },
  avatarWrap: { width: 44, height: 44 },
  typeBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1, gap: 2 },
  message: {
    color: COLORS.textSecondary,
    fontSize: TYPE.body,
    lineHeight: 19,
  },
  name: {
    color: COLORS.textPrimary,
    fontWeight: FONTS.bold,
  },
  time: { color: COLORS.textMuted, fontSize: TYPE.caption },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.accent,
  },

  skelAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
  },
  skelLine: { height: 9, borderRadius: 5, backgroundColor: COLORS.surface },
});
