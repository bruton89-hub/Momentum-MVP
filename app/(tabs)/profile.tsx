import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Image,
  Pressable,
  ScrollView,
  TextInput,
  Modal,
  Alert,
  Dimensions,
  Platform,
} from "react-native";

const SCREEN_W = Dimensions.get("window").width;
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { openAthleteProfile } from "@/utils/navigation";
import * as ImagePicker from "expo-image-picker";
import { signOut } from "firebase/auth";
import { serverTimestamp } from "firebase/firestore";
import { auth } from "@/config/firebase";
import { useAuthStore } from "@/store/authStore";
import { updateUserProfile, fetchUserProfile, uploadUserAvatar } from "@/hooks/useProfile";
import { createBattle, useBattles } from "@/hooks/useBattles";
import { useUserPosts } from "@/hooks/usePosts";
import { COLORS, SPACING, RADIUS, FONTS, ATHLETE_TYPES } from "@/constants/theme";
import AvatarImage from "@/components/AvatarImage";
import GlowButton from "@/components/GlowButton";
import EmptyState from "@/components/EmptyState";
import LoadingSpinner from "@/components/LoadingSpinner";
import MediaTile from "@/components/MediaTile";
import PostCard from "@/components/PostCard";
import type { Battle, Post, UserProfile } from "@/types";

type ProfileTab = "posts" | "battles" | "saved";

// ─── Edit Profile Modal ───────────────────────────────────────────────────────
function EditProfileModal({
  visible,
  onClose,
  userId,
  current,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  userId: string;
  current: UserProfile;
  onSaved: (updatedProfile: UserProfile) => void;
}) {
  const [username, setUsername] = useState(current.username);
  const [bio, setBio] = useState(current.bio);
  const [athleteType, setAthleteType] = useState(current.athleteType);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setUsername(current.username);
      setBio(current.bio);
      setAthleteType(current.athleteType);
      setAvatarUri(null);
    }
  }, [visible, current]);

  async function pickAvatar() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: Platform.OS !== "web",
        aspect: [1, 1],
        quality: 0.7,
      });
      if (!result.canceled && result.assets.length > 0) {
        const asset = result.assets[0];
        setAvatarUri(asset.uri);
      }
    } catch (err) {
      console.error("Profile avatar picker failed", err);
      Alert.alert("Avatar failed", "Could not select that image. Try again.");
    }
  }

  async function save() {
    if (!username.trim() || username.trim().length < 3) {
      Alert.alert("Invalid username", "Username must be at least 3 characters.");
      return;
    }
    setSaving(true);
    try {
      const editAvatar = avatarUri;
      const didAvatarChange = Boolean(
        editAvatar && editAvatar !== current.avatar && editAvatar !== current.avatarUrl
      );

      let avatarUrl = current.avatarUrl || current.avatar;
      if (didAvatarChange && editAvatar) {
        avatarUrl = await uploadUserAvatar(editAvatar, userId);
      }

      const payload: Parameters<typeof updateUserProfile>[1] = {
        username: username.trim(),
        bio: bio.trim(),
        sport: athleteType,
        avatarUrl,
        avatar: avatarUrl,
        updatedAt: serverTimestamp(),
      };

      await updateUserProfile(userId, payload);
      const profileAfterRead = await fetchUserProfile(userId);

      const updatedProfile: UserProfile = {
        ...current,
        username: username.trim(),
        bio: bio.trim(),
        athleteType,
        sport: athleteType,
        avatar: avatarUrl,
        avatarUrl,
        updatedAt: null,
      };

      onSaved(profileAfterRead ?? updatedProfile);
      onClose();
    } catch (err) {
      console.error("Profile save failed", err);
      const message = err instanceof Error ? err.message : "Could not update your profile. Try again.";
      Alert.alert("Save failed", message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={editStyles.overlay}>
        <View style={editStyles.sheet}>
          <View style={editStyles.handle} />
          <Text style={editStyles.title}>Edit Profile</Text>

          {/* Avatar */}
          <Pressable onPress={pickAvatar} style={editStyles.avatarWrap}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={editStyles.avatar} />
            ) : (
              <AvatarImage uri={current.avatar} username={current.username} size={72} />
            )}
            <View style={editStyles.avatarEditBadge}>
              <Text style={editStyles.avatarEditText}>✏️</Text>
            </View>
          </Pressable>

          {/* Fields */}
          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 400 }}>
            <Text style={editStyles.label}>Username</Text>
            <TextInput
              style={editStyles.input}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!saving}
              placeholderTextColor={COLORS.textMuted}
            />

            <Text style={editStyles.label}>Bio</Text>
            <TextInput
              style={[editStyles.input, editStyles.bioInput]}
              value={bio}
              onChangeText={setBio}
              multiline
              maxLength={160}
              editable={!saving}
              placeholder="Tell the arena who you are…"
              placeholderTextColor={COLORS.textMuted}
            />

            <Text style={editStyles.label}>Sport</Text>
            <View style={editStyles.chipGrid}>
              {ATHLETE_TYPES.map((t) => (
                <Pressable
                  key={t}
                  style={[editStyles.chip, athleteType === t && editStyles.chipActive]}
                  onPress={() => setAthleteType(t)}
                >
                  <Text style={[editStyles.chipText, athleteType === t && editStyles.chipTextActive]}>
                    {t}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>

          <GlowButton
            label="Save Changes"
            onPress={save}
            loading={saving}
            size="lg"
            style={{ marginTop: SPACING.lg }}
          />
          <Pressable onPress={onClose} style={editStyles.cancelBtn}>
            <Text style={editStyles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const editStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: SPACING.xl,
    paddingBottom: SPACING.xxxl,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.inputBorder,
    alignSelf: "center",
    marginBottom: SPACING.lg,
  },
  title: {
    color: COLORS.textPrimary,
    fontSize: 20,
    fontWeight: FONTS.heavy,
    marginBottom: SPACING.xl,
    textAlign: "center",
  },
  avatarWrap: {
    alignSelf: "center",
    marginBottom: SPACING.xl,
    position: "relative",
  },
  avatar: { width: 72, height: 72, borderRadius: 36 },
  avatarEditBadge: {
    position: "absolute",
    bottom: 0,
    right: -4,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  avatarEditText: { fontSize: 12 },
  label: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: FONTS.bold,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: SPACING.xs,
    marginTop: SPACING.md,
  },
  input: {
    backgroundColor: COLORS.input,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: RADIUS.md,
    color: COLORS.textPrimary,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontSize: 15,
  },
  bioInput: { minHeight: 72, textAlignVertical: "top" },
  chipGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  chip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    backgroundColor: COLORS.background,
  },
  chipActive: {
    backgroundColor: COLORS.accentFaint,
    borderColor: COLORS.accent,
  },
  chipText: { color: COLORS.textMuted, fontSize: 12, fontWeight: FONTS.medium },
  chipTextActive: { color: COLORS.accent, fontWeight: FONTS.bold },
  cancelBtn: {
    paddingVertical: SPACING.md,
    alignItems: "center",
    marginTop: SPACING.sm,
  },
  cancelText: { color: COLORS.textMuted, fontSize: 14 },
});

// ─── Post Thumbnail — uses MediaTile for native-safe rendering ───────────────
function PostThumb({ post, onPress }: { post: Post; onPress: () => void }) {
  const SIZE = (SCREEN_W - SPACING.lg * 2 - SPACING.sm * 2) / 3;
  const thumbStyle = { width: SIZE, height: SIZE, borderRadius: RADIUS.sm } as const;

  return (
    <Pressable style={{ position: "relative" }} onPress={onPress}>
      <MediaTile
        uri={post.mediaUrl || null}
        mediaType={post.mediaType}
        style={thumbStyle}
        context="ProfileGrid"
      />
      {/* Video badge overlay */}
      {post.mediaType === "video" && (
        <View
          style={{
            position: "absolute",
            top: 4,
            right: 4,
            backgroundColor: "rgba(0,0,0,0.6)",
            borderRadius: RADIUS.xs,
            paddingHorizontal: 4,
            paddingVertical: 1,
          }}
        >
          <Text style={{ color: COLORS.white, fontSize: 9, fontWeight: FONTS.bold }}>
            VIDEO
          </Text>
        </View>
      )}
    </Pressable>
  );
}

function PostDetailModal({
  post,
  visible,
  onClose,
  currentUserId,
  onBattle,
  isBattling,
}: {
  post: Post | null;
  visible: boolean;
  onClose: () => void;
  currentUserId: string | null;
  onBattle: (post: Post) => void;
  isBattling: boolean;
}) {
  if (!post) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.postModalSafe} edges={["top"]}>
        <View style={styles.postModalTopBar}>
          <Pressable
            onPress={onClose}
            style={styles.backBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.backIcon}>‹</Text>
          </Pressable>
        </View>
        <PostCard
          post={post}
          isLiked={false}
          onLike={() => undefined}
          currentUserId={currentUserId}
          onBattle={onBattle}
          isBattling={isBattling}
          enableVideoPlayback
          isActiveVideo
        />
      </SafeAreaView>
    </Modal>
  );
}

function BattleHistoryCard({
  battle,
  userId,
  currentUserId,
}: {
  battle: Battle;
  userId: string;
  currentUserId: string | null;
}) {
  const router = useRouter();
  const mine = battle.playerA?.userId === userId ? battle.playerA : battle.playerB;
  const opponent = battle.playerA?.userId === userId ? battle.playerB : battle.playerA;
  const result = battle.winner
    ? battle.winner === userId
      ? "WIN"
      : "LOSS"
    : battle.status.toUpperCase();
  const resultStyle = result === "WIN" ? styles.resultWin : result === "LOSS" ? styles.resultLoss : styles.resultLive;
  const date = formatBattleDate(battle.createdAt);

  return (
    <View style={styles.battleCard}>
      {/* MediaTile fills the 68×68 battleThumb container safely on iOS */}
      <MediaTile
        uri={mine?.mediaUrl || null}
        mediaType={mine?.mediaType}
        style={styles.battleThumb}
        context="BattleHistoryCard"
      />
      <View style={styles.battleInfo}>
        <View style={styles.battleMetaRow}>
          <Text style={[styles.resultPill, resultStyle]}>{result}</Text>
          <Text style={styles.battleDate}>{date}</Text>
        </View>
        <Text style={styles.battleTitle} numberOfLines={1}>
          {battle.category || "Battle"}
        </Text>
        {/* Opponent name: tappable to navigate to their profile */}
        {opponent?.userId ? (
          <Pressable
            onPress={() => openAthleteProfile(router, opponent!.userId, currentUserId)}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Text style={[styles.battleOpponent, styles.battleOpponentLink]} numberOfLines={1}>
              vs {opponent.username}
            </Text>
          </Pressable>
        ) : (
          <Text style={styles.battleOpponent} numberOfLines={1}>
            vs {opponent?.username || "Open challenge"}
          </Text>
        )}
      </View>
    </View>
  );
}

function formatBattleDate(value: Battle["createdAt"]) {
  if (!value) return "Recent";
  const date =
    typeof value.toDate === "function"
      ? value.toDate()
      : new Date((value as { seconds?: number }).seconds ? (value as { seconds: number }).seconds * 1000 : Date.now());
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ─── Main Profile Screen ──────────────────────────────────────────────────────
export default function ProfileScreen() {
  const userId = useAuthStore((s) => s.userId);
  const profileStore = useAuthStore((s) => s.profile);
  const setProfile = useAuthStore((s) => s.setProfile);
  const clearAuth = useAuthStore((s) => s.clear);

  const { posts, loading: postsLoading, refresh: refreshPosts } = useUserPosts(userId);
  const { battles, loading: battlesLoading } = useBattles(userId);
  const [editVisible, setEditVisible] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [activeTab, setActiveTab] = useState<ProfileTab>("posts");
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [startingBattlePostId, setStartingBattlePostId] = useState<string | null>(null);

  const profile = profileStore;
  const profileHandle = `@${profile?.username?.trim().toLowerCase().replace(/\s+/g, "") || "player"}`;
  const profileBattles = useMemo(
    () =>
      battles.filter(
        (battle) =>
          battle.playerA?.userId === userId ||
          battle.playerB?.userId === userId ||
          battle.creatorId === userId
      ),
    [battles, userId]
  );

  // Refresh posts when the Profile tab gains focus (tabs don't remount in Expo Router)
  useFocusEffect(
    useCallback(() => {
      refreshPosts();
      if (userId) {
        fetchUserProfile(userId).then((freshProfile) => {
          if (freshProfile) setProfile(freshProfile);
        });
      }
    }, [refreshPosts, setProfile, userId])
  );

  function handleSaved(updatedProfile: UserProfile) {
    setProfile(updatedProfile);
    refreshPosts();
  }

  async function doSignOut() {
    setSigningOut(true);
    try {
      await signOut(auth);
      // Clear store immediately so the tab layout redirects to /login
      // without waiting for the onAuthStateChanged round-trip.
      clearAuth();
    } catch {
      if (Platform.OS === "web") {
        if (typeof window !== "undefined") window.alert("Could not sign out.");
      } else {
        Alert.alert("Error", "Could not sign out.");
      }
    } finally {
      setSigningOut(false);
    }
  }

  function handleSignOut() {
    // Confirmation guard — prevents accidental sign-outs from the ⚙ gear tap.
    // NOTE: Alert.alert's multi-button + onPress callbacks are not supported on
    // web (react-native-web only polyfills a basic window.alert that ignores the
    // buttons array), so the confirm button's onPress never fires there. Use
    // window.confirm on web and keep the native Alert dialog on iOS/Android.
    if (Platform.OS === "web") {
      const confirmed =
        typeof window !== "undefined" && typeof window.confirm === "function"
          ? window.confirm("Are you sure you want to sign out?")
          : true;
      if (confirmed) void doSignOut();
      return;
    }

    Alert.alert(
      "Sign Out",
      "Are you sure you want to sign out?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign Out",
          style: "destructive",
          onPress: () => {
            void doSignOut();
          },
        },
      ]
    );
  }

  async function handleBattle(post: Post) {
    if (!userId || !profile) return;

    setStartingBattlePostId(post.id);
    try {
      await createBattle({
        creatorId: userId,
        playerA: {
          userId: post.userId,
          username: post.username,
          avatar: post.userAvatar,
          mediaUrl: post.mediaUrl,
          mediaType: post.mediaType,
          postId: post.id,
        },
        category: "Highlights",
        durationHours: 24,
      });
      Alert.alert("Challenge open", "Your post is now open for challenges.");
      setSelectedPost(null);
    } catch (err) {
      console.error("Start battle from profile failed", err);
      Alert.alert("Failed", "Could not create battle. Please try again.");
    } finally {
      setStartingBattlePostId(null);
    }
  }

  if (!profile) return <LoadingSpinner fullscreen />;

  const listData = activeTab === "posts" ? posts : activeTab === "battles" ? profileBattles : [];
  const tabs: { key: ProfileTab; label: string }[] = [
    { key: "posts", label: "Posts" },
    { key: "battles", label: "Battles" },
    { key: "saved", label: "Saved" },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <FlatList<Post | Battle>
        key={activeTab}
        data={listData}
        keyExtractor={(item) => item.id}
        numColumns={activeTab === "posts" ? 3 : 1}
        columnWrapperStyle={activeTab === "posts" ? { gap: SPACING.sm } : undefined}
        contentContainerStyle={styles.grid}
        renderItem={({ item }) =>
          activeTab === "posts" ? (
            <PostThumb post={item as Post} onPress={() => setSelectedPost(item as Post)} />
          ) : (
            <BattleHistoryCard battle={item as Battle} userId={userId ?? ""} currentUserId={userId} />
          )
        }
        ListHeaderComponent={
          <View style={styles.profileHeader}>
            {/* ── Settings icon top-right ─────────────────────────────────── */}
            <View style={styles.profileTopBar}>
              <View style={styles.profileTopBarSpacer} />
              <Pressable
                onPress={handleSignOut}
                style={styles.settingsBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.settingsIcon}>⚙</Text>
              </Pressable>
            </View>

            {/* ── Identity: avatar + name/handle ──────────────────────────── */}
            <View style={styles.identityRow}>
              {/* Avatar with neon ring */}
              <View style={styles.avatarRingWrap}>
                <AvatarImage uri={profile.avatar} username={profile.username} size={80} />
              </View>
              <View style={styles.identityText}>
                <Text style={styles.username}>{profile.username}</Text>
                <Text style={styles.handle}>{profileHandle}</Text>
              </View>
            </View>

            {/* ── Stats row with dividers ─────────────────────────────────── */}
            {/* posts.length is used instead of profile.posts because Firestore
                rules block client-side updates to the posts counter field, so
                profile.posts is always stale. The posts array is already fresh
                from useUserPosts which is refreshed on every focus. */}
            <View style={styles.statsRow}>
              <Stat label="Posts" value={posts.length} />
              <View style={styles.statDivider} />
              <Stat label="Wins" value={profile.wins} />
              <View style={styles.statDivider} />
              <Stat label="Losses" value={profile.losses} />
            </View>

            {/* ── Bio / sport / school lines ──────────────────────────────── */}
            {(profile.athleteType || profile.bio) ? (
              <View style={styles.bioSection}>
                {profile.athleteType ? (
                  <Text style={styles.sport}>{profile.athleteType}</Text>
                ) : null}
                {profile.bio ? (
                  <Text style={styles.bio}>{profile.bio}</Text>
                ) : null}
              </View>
            ) : null}

            {/* ── Action buttons ──────────────────────────────────────────── */}
            <View style={styles.actionRow}>
              <GlowButton
                label="Edit Profile"
                onPress={() => setEditVisible(true)}
                variant="secondary"
                size="sm"
                style={{ flex: 1 }}
              />
              <GlowButton
                label="Sign Out"
                onPress={handleSignOut}
                loading={signingOut}
                variant="ghost"
                size="sm"
                style={{ flex: 1 }}
              />
            </View>

            {/* ── Posts / Battles / Saved tabs ────────────────────────────── */}
            <View style={styles.tabs}>
              {tabs.map((tab) => {
                const isActive = activeTab === tab.key;
                return (
                  <Pressable
                    key={tab.key}
                    onPress={() => setActiveTab(tab.key)}
                    style={styles.tabButton}
                  >
                    <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                      {tab.label}
                    </Text>
                    <View style={[styles.tabUnderline, isActive && styles.tabUnderlineActive]} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        }
        ListEmptyComponent={
          activeTab === "posts" && postsLoading ? (
            <LoadingSpinner label="Loading posts…" />
          ) : activeTab === "battles" && battlesLoading ? (
            <LoadingSpinner label="Loading battles…" />
          ) : activeTab === "battles" ? (
            <EmptyState
              icon="⚔️"
              title="No battle history"
              subtitle="Completed battles will show up here."
            />
          ) : activeTab === "saved" ? (
            <EmptyState
              icon="🔖"
              title="No saved posts"
              subtitle="Saved posts will show up here."
            />
          ) : (
            <EmptyState
              icon="📷"
              title="Complete your athlete profile"
              subtitle="Add your sport, bio, and first highlight."
              actionLabel="Edit Profile"
              onAction={() => setEditVisible(true)}
            />
          )
        }
        showsVerticalScrollIndicator={false}
      />

      <EditProfileModal
        visible={editVisible}
        onClose={() => setEditVisible(false)}
        userId={userId ?? ""}
        current={profile}
        onSaved={handleSaved}
      />
      <PostDetailModal
        visible={!!selectedPost}
        post={selectedPost}
        onClose={() => setSelectedPost(null)}
        currentUserId={userId}
        onBattle={handleBattle}
        isBattling={!!selectedPost && startingBattlePostId === selectedPost.id}
      />
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  postModalSafe: { flex: 1, backgroundColor: COLORS.background },
  postModalTopBar: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xs,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  backIcon: { color: COLORS.textPrimary, fontSize: 22, lineHeight: 28, marginTop: -2 },

  profileHeader: {
    paddingBottom: 0,
    backgroundColor: COLORS.background,
  },

  // ── Top bar (settings) ────────────────────────────────────────────────────
  profileTopBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  profileTopBarSpacer: { flex: 1 },
  settingsBtn: {
    width: 36, height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  settingsIcon: { color: COLORS.textSecondary, fontSize: 18 },

  // ── Identity ──────────────────────────────────────────────────────────────
  identityRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.lg,
    gap: SPACING.lg,
  },
  avatarRingWrap: {
    borderRadius: 46,
    borderWidth: 3,
    borderColor: COLORS.accent,
    padding: 2,
    overflow: "hidden",
  },
  identityText: { flex: 1 },
  username: {
    color: COLORS.textPrimary,
    fontSize: 24,
    fontWeight: FONTS.heavy,
    marginBottom: 3,
  },
  handle: {
    color: COLORS.textHandle,
    fontSize: 14,
    fontWeight: FONTS.medium,
  },

  // ── Stats ─────────────────────────────────────────────────────────────────
  statsRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.xl,
    borderTopWidth: 1,
    borderTopColor: COLORS.cardBorder,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
    marginBottom: SPACING.md,
  },
  stat: {
    flex: 1,
    alignItems: "center",
  },
  statDivider: {
    width: 1,
    height: 36,
    backgroundColor: COLORS.cardBorder,
  },
  statValue: {
    color: COLORS.textPrimary,
    fontSize: 22,
    fontWeight: FONTS.heavy,
  },
  statLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    marginTop: 3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  // ── Bio / sport ───────────────────────────────────────────────────────────
  bioSection: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
    gap: 4,
    alignItems: "center",
  },
  sport: {
    color: COLORS.accent,
    fontSize: 14,
    fontWeight: FONTS.semibold,
    textAlign: "center",
  },
  bio: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },

  // ── Action buttons ────────────────────────────────────────────────────────
  actionRow: {
    flexDirection: "row",
    gap: SPACING.sm,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
  },

  // ── Tabs ──────────────────────────────────────────────────────────────────
  tabs: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  tabButton: {
    flex: 1,
    alignItems: "center",
    paddingTop: SPACING.sm,
    paddingBottom: 0,
  },
  tabText: {
    color: COLORS.textMuted,
    fontSize: 14,
    fontWeight: FONTS.bold,
  },
  tabTextActive: { color: COLORS.textPrimary },
  tabUnderline: {
    width: "80%",
    height: 2,
    borderRadius: 2,
    backgroundColor: COLORS.transparent,
    marginTop: SPACING.sm,
  },
  tabUnderlineActive: { backgroundColor: COLORS.accent },

  // ── Grid ─────────────────────────────────────────────────────────────────
  grid: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.xxxl,
    gap: SPACING.sm,
  },

  // ── Battle history cards ──────────────────────────────────────────────────
  battleCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
    gap: SPACING.md,
  },
  battleThumb: {
    width: 68,
    height: 68,
    borderRadius: RADIUS.md,
    overflow: "hidden",
    backgroundColor: COLORS.surface,
    flexShrink: 0,
  },
  battleInfo: { flex: 1 },
  battleMetaRow: {
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
    fontSize: 11,
    fontWeight: FONTS.heavy,
  },
  resultWin:  { color: COLORS.accent, backgroundColor: COLORS.accentFaint },
  resultLoss: { color: COLORS.error, backgroundColor: COLORS.errorFaint },
  resultLive: { color: COLORS.textSecondary, backgroundColor: COLORS.input },
  battleDate: { color: COLORS.textMuted, fontSize: 12 },
  battleTitle: { color: COLORS.textPrimary, fontSize: 15, fontWeight: FONTS.bold, marginBottom: 2 },
  battleOpponent: { color: COLORS.textSecondary, fontSize: 13 },
  battleOpponentLink: { color: COLORS.accent, textDecorationLine: "underline" },
});
