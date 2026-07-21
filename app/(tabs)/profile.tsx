import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Image,
  Pressable,
  ScrollView,
  TextInput,
  Modal,
  Alert,
  Platform,
  Share,
  KeyboardAvoidingView,
  FlatList,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import Animated, {
  useSharedValue,
  useAnimatedScrollHandler,
} from "react-native-reanimated";
import { signOut } from "firebase/auth";
import { serverTimestamp } from "firebase/firestore";
import { auth } from "@/config/firebase";
import { useAuthStore } from "@/store/authStore";
import { updateUserProfile, fetchUserProfile, uploadUserAvatar } from "@/hooks/useProfile";
import { createBattle, useBattles } from "@/hooks/useBattles";
import { useUserPosts } from "@/hooks/usePosts";
import {
  COLORS,
  SPACING,
  RADIUS,
  FONTS,
  ATHLETE_TYPES,
  TRENDING_LIKES_THRESHOLD,
} from "@/constants/theme";
import { toHandle } from "@/utils/format";
import { isVideoMedia } from "@/utils/media";
import AvatarImage from "@/components/AvatarImage";
import GlowButton from "@/components/GlowButton";
import EmptyState from "@/components/EmptyState";
import LoadingSpinner from "@/components/LoadingSpinner";
import IconButton from "@/components/IconButton";
import ProfileHeader from "@/components/ProfileHeader";
import ProfileTabs, { ProfileTabDef } from "@/components/ProfileTabs";
import ProfileCompactBar, { COMPACT_BAR_HEIGHT } from "@/components/ProfileCompactBar";
import ProfileGridSkeleton from "@/components/ProfileGridSkeleton";
import PostGridThumb from "@/components/PostGridThumb";
import BattleHistoryCard from "@/components/BattleHistoryCard";
import PostDetailModal from "@/components/PostDetailModal";
import Chip from "@/components/Chip";
import type { Battle, Post, UserProfile } from "@/types";

type ProfileTab = "posts" | "highlights" | "battles" | "saved";

const PROFILE_TABS: readonly ProfileTabDef<ProfileTab>[] = [
  { key: "posts", label: "Posts", icon: "grid" },
  { key: "highlights", label: "Highlights", icon: "play" },
  { key: "battles", label: "Battles", icon: "zap" },
  { key: "saved", label: "Saved", icon: "bookmark" },
];
const profileItemKey = (item: Post | Battle) => item.id;

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
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState(current.username);
  const [bio, setBio] = useState(current.bio);
  const [athleteType, setAthleteType] = useState(current.athleteType);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = React.useRef(false);

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
      if (result.canceled) return;
      const uri = result.assets?.[0]?.uri?.trim();
      if (!uri) {
        console.error("[EditProfileModal] Image picker returned no usable URI", result);
        Alert.alert("Image unavailable", "That image could not be selected. Please try another.");
        return;
      }
      setAvatarUri(uri);
    } catch (err) {
      console.error("[EditProfileModal] Profile image picker failed", err);
      Alert.alert("Avatar failed", "Could not select that image. Try again.");
    }
  }

  async function save() {
    if (savingRef.current) return;
    if (!username.trim() || username.trim().length < 3) {
      Alert.alert("Invalid username", "Username must be at least 3 characters.");
      return;
    }
    const authenticatedUserId = auth.currentUser?.uid;
    if (!userId || !authenticatedUserId || authenticatedUserId !== userId) {
      console.error("[EditProfileModal] Profile save rejected: missing or mismatched user", {
        profileUserId: userId || null,
        authenticatedUserId: authenticatedUserId || null,
      });
      Alert.alert("Sign in required", "Please sign in again before saving your profile.");
      return;
    }

    savingRef.current = true;
    setSaving(true);
    let imageUploadFailed = false;
    try {
      const editAvatar = avatarUri;
      const didAvatarChange = Boolean(
        editAvatar && editAvatar !== current.avatar && editAvatar !== current.avatarUrl
      );

      let avatarUrl = current.avatarUrl || current.avatar;
      if (didAvatarChange && editAvatar) {
        try {
          avatarUrl = await uploadUserAvatar(editAvatar, authenticatedUserId);
        } catch (uploadError) {
          imageUploadFailed = true;
          console.error("[EditProfileModal] Continuing profile save after image upload failure", {
            userId: authenticatedUserId,
            uriScheme: editAvatar.split(":")[0] || "unknown",
            error: uploadError,
          });
        }
      }

      const payload: Parameters<typeof updateUserProfile>[1] = {
        username: username.trim(),
        bio: bio.trim(),
        sport: athleteType,
        avatarUrl,
        avatar: avatarUrl,
        updatedAt: serverTimestamp(),
      };

      await updateUserProfile(authenticatedUserId, payload);
      const profileAfterRead = await fetchUserProfile(authenticatedUserId);

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
      if (imageUploadFailed) {
        Alert.alert(
          "Profile saved",
          "Your profile details were saved, but the profile image could not be uploaded. Please try the image again."
        );
      }
    } catch (err) {
      console.error("[EditProfileModal] Profile document update failed", {
        userId: authenticatedUserId,
        error: err,
      });
      Alert.alert("Save failed", "Could not update your profile. Please try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={editStyles.overlay}>
        {/* KEYBOARD: text inputs live in a bottom sheet — without avoidance the
            iOS keyboard covers the Bio field and Save button. */}
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          pointerEvents="box-none"
        >
        {/* SAFE AREA: Cancel sits at the sheet bottom on the screen edge. */}
        <View style={[editStyles.sheet, { paddingBottom: insets.bottom + SPACING.xl }]}>
          <View style={editStyles.handle} />
          <Text style={editStyles.title}>Edit Profile</Text>

          {/* Avatar */}
          <Pressable
            onPress={pickAvatar}
            accessibilityRole="button"
            accessibilityLabel="Change profile photo"
            style={({ pressed }) => [editStyles.avatarWrap, pressed && { opacity: 0.8 }]}
          >
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={editStyles.avatar} />
            ) : (
              <AvatarImage uri={current.avatar} username={current.username} size={72} />
            )}
            <View style={editStyles.avatarEditBadge}>
              <Feather name="edit-2" size={11} color={COLORS.textSecondary} />
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
                <Chip
                  key={t}
                  label={t}
                  selected={athleteType === t}
                  onPress={() => setAthleteType(t)}
                  disabled={saving}
                />
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
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Cancel editing"
            style={({ pressed }) => [editStyles.cancelBtn, pressed && { opacity: 0.7 }]}
          >
            <Text style={editStyles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
        </KeyboardAvoidingView>
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
    // paddingBottom applied inline — safe-area dependent.
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
  cancelBtn: {
    paddingVertical: SPACING.md,
    alignItems: "center",
    marginTop: SPACING.sm,
  },
  cancelText: { color: COLORS.textMuted, fontSize: 14 },
});

// ─── Main Profile Screen ──────────────────────────────────────────────────────
export default function ProfileScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);
  const profileStore = useAuthStore((s) => s.profile);
  const setProfile = useAuthStore((s) => s.setProfile);
  const clearAuth = useAuthStore((s) => s.clear);

  const { posts, loading: postsLoading, refresh: refreshPosts } = useUserPosts(userId);
  // includeVotes=false: this screen only renders battle history rows and never
  // shows or casts votes, so skip the votedMap lookups (3 Firestore `in`
  // queries per mount).
  const { battles, loading: battlesLoading } = useBattles(userId, false);
  const [editVisible, setEditVisible] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [activeTab, setActiveTab] = useState<ProfileTab>("posts");
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [startingBattlePostId, setStartingBattlePostId] = useState<string | null>(null);
  const startingBattleRef = React.useRef<string | null>(null);
  const listRef = React.useRef<FlatList<Post | Battle>>(null);

  // Collapsing header — scroll offset lives on the UI thread only.
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  const profile = profileStore;
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
  const hasFocusedRef = React.useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedRef.current) {
        hasFocusedRef.current = true;
        return;
      }
      void refreshPosts();
      if (userId) {
        void fetchUserProfile(userId).then((freshProfile) => {
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
    if (!userId || !profile || startingBattleRef.current) return;

    startingBattleRef.current = post.id;
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
      startingBattleRef.current = null;
      setStartingBattlePostId(null);
    }
  }

  // ── Derived lists (memoized — no extra queries, no re-sorting per render) ──
  const sortedPosts = useMemo(() => {
    const pinned = posts.filter((p) => p.pinned);
    if (pinned.length === 0) return posts;
    return [...pinned, ...posts.filter((p) => !p.pinned)];
  }, [posts]);

  const highlightPosts = useMemo(
    () => sortedPosts.filter((p) => isVideoMedia(p.mediaUrl, p.mediaType)),
    [sortedPosts]
  );

  const hasTrendingPost = useMemo(
    () => posts.some((p) => p.likesCount >= TRENDING_LIKES_THRESHOLD),
    [posts]
  );

  const handleTabChange = useCallback(
    (tab: ProfileTab) => {
      scrollY.value = 0;
      setActiveTab(tab);
    },
    [scrollY]
  );

  // Keep the list instance when the column layout is unchanged, but still
  // reset the newly selected tab to the top without an animated transition.
  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [activeTab]);

  const handleShareProfile = useCallback(async () => {
    if (!profile) return;
    const message = `Check out ${profile.username} (${toHandle(profile.username)}) on Momentum — highlights, battles, and more.`;
    try {
      await Share.share({ message });
    } catch {
      // Share sheet unavailable (e.g. desktop web) — non-fatal.
    }
  }, [profile]);

  const isGridTab = activeTab === "posts" || activeTab === "highlights";
  const listData = useMemo<(Post | Battle)[]>(
    () =>
      activeTab === "posts"
        ? sortedPosts
        : activeTab === "highlights"
        ? highlightPosts
        : activeTab === "battles"
        ? profileBattles
        : [],
    [activeTab, highlightPosts, profileBattles, sortedPosts]
  );
  const renderProfileItem = useCallback(
    ({ item }: { item: Post | Battle }) =>
      isGridTab ? (
        <PostGridThumb post={item as Post} onPress={setSelectedPost} context="ProfileGrid" />
      ) : (
        <BattleHistoryCard
          battle={item as Battle}
          userId={userId ?? ""}
          currentUserId={userId}
        />
      ),
    [isGridTab, userId]
  );

  if (!profile) return <LoadingSpinner fullscreen />;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Animated.FlatList
        ref={listRef}
        key={isGridTab ? "profile-grid" : "profile-list"}
        data={listData}
        keyExtractor={profileItemKey}
        numColumns={isGridTab ? 3 : 1}
        columnWrapperStyle={isGridTab ? styles.gridColumns : undefined}
        contentContainerStyle={styles.grid}
        initialNumToRender={isGridTab ? 9 : 6}
        maxToRenderPerBatch={isGridTab ? 9 : 6}
        updateCellsBatchingPeriod={50}
        windowSize={7}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        renderItem={renderProfileItem}
        ListHeaderComponent={
          <View style={styles.headerWrap}>
            <ProfileHeader
              profile={profile}
              postsCount={posts.length}
              battlesCount={profileBattles.length}
              isOwn
              hasTrendingPost={hasTrendingPost}
              onEdit={() => setEditVisible(true)}
              onShare={handleShareProfile}
              scrollY={scrollY}
            />
            <ProfileTabs
              tabs={PROFILE_TABS}
              activeKey={activeTab}
              onChange={handleTabChange}
            />
          </View>
        }
        ListEmptyComponent={
          activeTab === "posts" && postsLoading ? (
            <ProfileGridSkeleton />
          ) : activeTab === "highlights" && postsLoading ? (
            <ProfileGridSkeleton />
          ) : activeTab === "battles" && battlesLoading ? (
            <LoadingSpinner label="Loading battles…" />
          ) : activeTab === "battles" ? (
            <EmptyState
              icon="⚔️"
              title="Challenge another athlete"
              subtitle="Win battles to build your record — victories show up here."
              actionLabel="Find a battle"
              onAction={() => router.push("/battles" as never)}
            />
          ) : activeTab === "saved" ? (
            <EmptyState
              icon="🔖"
              title="No saved posts yet"
              subtitle="Highlights you save will live here."
            />
          ) : activeTab === "highlights" ? (
            <EmptyState
              icon="🎬"
              title="No video highlights yet"
              subtitle="Video posts appear here automatically."
              actionLabel="Upload a highlight"
              onAction={() => router.push("/create" as never)}
            />
          ) : !profile.bio ? (
            <EmptyState
              icon="📋"
              title="Complete your profile"
              subtitle="Add your sport, bio, and first highlight so coaches can find you."
              actionLabel="Edit Profile"
              onAction={() => setEditVisible(true)}
            />
          ) : (
            <EmptyState
              icon="🎬"
              title="Upload your first highlight"
              subtitle="Your best plays belong on your profile."
              actionLabel="Upload a highlight"
              onAction={() => router.push("/create" as never)}
            />
          )
        }
        showsVerticalScrollIndicator={false}
      />

      {/* Collapsing compact bar — name fades in as the header scrolls away */}
      <ProfileCompactBar
        username={profile.username}
        avatarUri={profile.avatarUrl || profile.avatar}
        verified={profile.verified}
        scrollY={scrollY}
        right={
          <IconButton
            icon="log-out"
            accessibilityLabel="Sign out"
            onPress={handleSignOut}
            disabled={signingOut}
          />
        }
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },

  // Header + tabs render full-bleed inside the padded grid container.
  headerWrap: {
    marginHorizontal: -SPACING.lg,
    marginBottom: SPACING.sm,
  },

  // ── Grid ─────────────────────────────────────────────────────────────────
  // paddingHorizontal must stay SPACING.lg — PostGridThumb's CELL math and
  // ProfileGridSkeleton both assume it.
  grid: {
    paddingTop: COMPACT_BAR_HEIGHT,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.xxxl,
    gap: SPACING.sm,
  },
  gridColumns: { gap: SPACING.sm },
});
