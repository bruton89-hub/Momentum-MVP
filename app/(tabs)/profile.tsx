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
  Platform,
  Share,
  KeyboardAvoidingView,
  FlatList,
} from "react-native";
import { showAlert, confirm } from "@/utils/alert";
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
import {
  updateUserProfile,
  fetchUserProfile,
  uploadUserAvatar,
  uploadUserBanner,
  isUsernameTaken,
  searchFieldsFor,
} from "@/hooks/useProfile";
import { createBattle, useBattles, isCountableBattle } from "@/hooks/useBattles";
import { useUserPosts } from "@/hooks/usePosts";
import { useSavedPosts } from "@/hooks/useSaves";
import { LinearGradient } from "expo-linear-gradient";
import {
  COLORS,
  SPACING,
  RADIUS,
  FONTS,
  TYPE,
  ATHLETE_TYPES,
  TRENDING_LIKES_THRESHOLD,
  bannerGradientForSport,
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
import ProfileCompactBar from "@/components/ProfileCompactBar";
import ProfileGridSkeleton from "@/components/ProfileGridSkeleton";
import PostGridThumb from "@/components/PostGridThumb";
import BattleHistoryCard from "@/components/BattleHistoryCard";
import PostDetailModal from "@/components/PostDetailModal";
import Chip from "@/components/Chip";
import type { Battle, Post, UserProfile } from "@/types";
import type { CreationMutation } from "@/utils/creationMutation";
import { createCreationMutation } from "@/utils/creationMutation";
import { canCommitProfile } from "@/utils/remediationGuards";

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
  const [avatarAsset, setAvatarAsset] =
    useState<ImagePicker.ImagePickerAsset | null>(null);
  const [bannerAsset, setBannerAsset] =
    useState<ImagePicker.ImagePickerAsset | null>(null);
  // ── Athlete identity. These render on the profile header but had no edit
  //    surface anywhere in the app, so they could never be filled in — which
  //    is exactly the information a coach or recruiter scans for first.
  const [position, setPosition] = useState(current.position ?? "");
  const [school, setSchool] = useState(current.school ?? "");
  const [city, setCity] = useState(current.city ?? "");
  const [stateRegion, setStateRegion] = useState(current.state ?? "");
  const [gradYear, setGradYear] = useState(current.gradYear ?? "");
  const [saving, setSaving] = useState(false);
  const savingRef = React.useRef(false);

  useEffect(() => {
    if (visible) {
      setUsername(current.username);
      setBio(current.bio);
      setAthleteType(current.athleteType);
      setAvatarAsset(null);
      setBannerAsset(null);
      setPosition(current.position ?? "");
      setSchool(current.school ?? "");
      setCity(current.city ?? "");
      setStateRegion(current.state ?? "");
      setGradYear(current.gradYear ?? "");
    }
  }, [visible, current]);

  const isDirty =
    username !== current.username ||
    bio !== current.bio ||
    athleteType !== current.athleteType ||
    position !== (current.position ?? "") ||
    school !== (current.school ?? "") ||
    city !== (current.city ?? "") ||
    stateRegion !== (current.state ?? "") ||
    gradYear !== (current.gradYear ?? "") ||
    !!avatarAsset ||
    !!bannerAsset;

  async function pickImage(kind: "avatar" | "banner") {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: Platform.OS !== "web",
        // Crop to the shape each image is actually displayed in, so what the
        // athlete frames in the picker is what lands on their profile.
        aspect: kind === "avatar" ? [1, 1] : [16, 9],
        quality: 0.7,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      const uri = asset?.uri?.trim();
      if (!uri) {
        console.error("[EditProfileModal] Image picker returned no usable URI", result);
        showAlert("Image unavailable", "That image could not be selected. Please try another.");
        return;
      }
      if (kind === "avatar") setAvatarAsset(asset);
      else setBannerAsset(asset);
    } catch (err) {
      console.error(`[EditProfileModal] ${kind} picker failed`, err);
      showAlert("Image failed", "Could not select that image. Try again.");
    }
  }

  /** Close, confirming first if there are unsaved edits. */
  async function requestClose() {
    if (saving) return;
    if (!isDirty) {
      onClose();
      return;
    }
    const discard = await confirm({
      title: "Discard changes?",
      message: "Your edits to this profile will be lost.",
      confirmLabel: "Discard",
      cancelLabel: "Keep editing",
      destructive: true,
    });
    if (discard) onClose();
  }

  async function save() {
    if (savingRef.current) return;
    const trimmedUsername = username.trim();
    if (trimmedUsername.length < 3) {
      showAlert("Invalid username", "Username must be at least 3 characters.");
      return;
    }
    const trimmedGradYear = gradYear.trim();
    if (trimmedGradYear && !/^\d{4}$/.test(trimmedGradYear)) {
      showAlert("Invalid graduation year", "Enter a four-digit year, e.g. 2027.");
      return;
    }
    const authenticatedUserId = auth.currentUser?.uid;
    if (!userId || !authenticatedUserId || authenticatedUserId !== userId) {
      console.error("[EditProfileModal] Profile save rejected: missing or mismatched user", {
        profileUserId: userId || null,
        authenticatedUserId: authenticatedUserId || null,
      });
      showAlert("Sign in required", "Please sign in again before saving your profile.");
      return;
    }

    savingRef.current = true;
    setSaving(true);
    const imageFailures: string[] = [];
    try {
      // Usernames are the public handle and are used to identify athletes, so
      // two people must not be able to claim the same one. isUsernameTaken has
      // existed since registration shipped but the edit path never called it.
      if (trimmedUsername !== current.username) {
        const taken = await isUsernameTaken(trimmedUsername, authenticatedUserId);
        if (taken) {
          showAlert(
            "Username taken",
            `${trimmedUsername} is already claimed by another athlete. Try a different one.`
          );
          return;
        }
      }

      const editAvatar = avatarAsset;
      const didAvatarChange = Boolean(
        editAvatar &&
          editAvatar.uri !== current.avatar &&
          editAvatar.uri !== current.avatarUrl
      );

      let avatarUrl = current.avatarUrl || current.avatar;
      if (didAvatarChange && editAvatar) {
        try {
          avatarUrl = await uploadUserAvatar(editAvatar, authenticatedUserId);
        } catch (uploadError) {
          imageFailures.push("profile photo");
          console.error("[EditProfileModal] Continuing profile save after avatar upload failure", {
            userId: authenticatedUserId,
            uriScheme: editAvatar.uri.split(":")[0] || "unknown",
            error: uploadError,
          });
        }
      }

      let bannerUrl = current.bannerUrl;
      if (bannerAsset) {
        try {
          bannerUrl = await uploadUserBanner(bannerAsset, authenticatedUserId);
        } catch (uploadError) {
          imageFailures.push("banner");
          console.error("[EditProfileModal] Continuing profile save after banner upload failure", {
            userId: authenticatedUserId,
            uriScheme: bannerAsset.uri.split(":")[0] || "unknown",
            error: uploadError,
          });
        }
      }

      const payload: Parameters<typeof updateUserProfile>[1] = {
        username: trimmedUsername,
        bio: bio.trim(),
        sport: athleteType,
        // Written alongside `sport` so older readers that only know
        // `athleteType` don't drift out of sync after an edit.
        athleteType,
        avatarUrl,
        avatar: avatarUrl,
        // Empty strings clear a field rather than deleting the key —
        // normalizeUserProfile collapses "" back to undefined on read.
        position: position.trim(),
        school: school.trim(),
        city: city.trim(),
        state: stateRegion.trim(),
        gradYear: trimmedGradYear,
        // Keeps the prefix-search index in lockstep with the display values —
        // an athlete who renames themselves stays findable under the new name.
        ...searchFieldsFor({
          username: trimmedUsername,
          school: school.trim(),
          city: city.trim(),
        }),
        updatedAt: serverTimestamp(),
      };
      if (bannerUrl) payload.bannerUrl = bannerUrl;

      await updateUserProfile(authenticatedUserId, payload);
      const profileAfterRead = await fetchUserProfile(authenticatedUserId);

      const updatedProfile: UserProfile = {
        ...current,
        username: trimmedUsername,
        bio: bio.trim(),
        athleteType,
        sport: athleteType,
        avatar: avatarUrl,
        avatarUrl,
        bannerUrl,
        position: position.trim() || undefined,
        school: school.trim() || undefined,
        city: city.trim() || undefined,
        state: stateRegion.trim() || undefined,
        gradYear: trimmedGradYear || undefined,
        updatedAt: null,
      };

      onSaved(profileAfterRead ?? updatedProfile);
      onClose();
      if (imageFailures.length > 0) {
        showAlert(
          "Profile saved",
          `Your details were saved, but the ${imageFailures.join(" and ")} could not be uploaded. Please try the image again.`
        );
      }
    } catch (err) {
      console.error("[EditProfileModal] Profile document update failed", {
        userId: authenticatedUserId,
        error: err,
      });
      showAlert("Save failed", "Could not update your profile. Please try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={requestClose}>
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

          {/* ── Banner + avatar, previewed in the layout they'll appear in ──── */}
          <View style={editStyles.mediaPreview}>
            <Pressable
              onPress={() => pickImage("banner")}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel={
                bannerAsset || current.bannerUrl ? "Change banner image" : "Add a banner image"
              }
              style={({ pressed }) => [editStyles.bannerWrap, pressed && { opacity: 0.85 }]}
            >
              {bannerAsset || current.bannerUrl ? (
                <Image
                  source={{ uri: bannerAsset?.uri || (current.bannerUrl as string) }}
                  style={editStyles.bannerImage}
                  resizeMode="cover"
                />
              ) : (
                <LinearGradient
                  colors={[...bannerGradientForSport(athleteType)]}
                  start={{ x: 0.1, y: 0 }}
                  end={{ x: 0.9, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
              )}
              <View style={editStyles.bannerHint}>
                <Feather name="image" size={12} color={COLORS.white} />
                <Text style={editStyles.bannerHintText}>
                  {bannerAsset || current.bannerUrl ? "Change banner" : "Add banner"}
                </Text>
              </View>
            </Pressable>

            <Pressable
              onPress={() => pickImage("avatar")}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="Change profile photo"
              style={({ pressed }) => [editStyles.avatarWrap, pressed && { opacity: 0.8 }]}
            >
              {avatarAsset ? (
                <Image source={{ uri: avatarAsset.uri }} style={editStyles.avatar} />
              ) : (
                <AvatarImage uri={current.avatar} username={current.username} size={64} />
              )}
              <View style={editStyles.avatarEditBadge}>
                <Feather name="edit-2" size={11} color={COLORS.textSecondary} />
              </View>
            </Pressable>
          </View>

          {/* Fields */}
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            style={editStyles.fields}
          >
            <Text style={editStyles.label}>Username</Text>
            <TextInput
              style={editStyles.input}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!saving}
              maxLength={30}
              accessibilityLabel="Username"
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
              accessibilityLabel="Bio, optional"
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

            {/* ── Recruiting details ──────────────────────────────────────── */}
            <Text style={editStyles.sectionNote}>
              These show on your profile header — the first thing a coach reads.
            </Text>

            <Text style={editStyles.label}>Position</Text>
            <TextInput
              style={editStyles.input}
              value={position}
              onChangeText={setPosition}
              editable={!saving}
              maxLength={40}
              placeholder="e.g. QB, Point Guard"
              accessibilityLabel="Position, optional"
              placeholderTextColor={COLORS.textMuted}
            />

            <Text style={editStyles.label}>School or team</Text>
            <TextInput
              style={editStyles.input}
              value={school}
              onChangeText={setSchool}
              editable={!saving}
              maxLength={60}
              placeholder="e.g. Lincoln High"
              accessibilityLabel="School or team, optional"
              placeholderTextColor={COLORS.textMuted}
            />

            <View style={editStyles.fieldRow}>
              <View style={editStyles.fieldGrow}>
                <Text style={editStyles.label}>City</Text>
                <TextInput
                  style={editStyles.input}
                  value={city}
                  onChangeText={setCity}
                  editable={!saving}
                  maxLength={40}
                  placeholder="e.g. Dallas"
                  accessibilityLabel="City, optional"
                  placeholderTextColor={COLORS.textMuted}
                />
              </View>
              <View style={editStyles.fieldShort}>
                <Text style={editStyles.label}>State</Text>
                <TextInput
                  style={editStyles.input}
                  value={stateRegion}
                  onChangeText={setStateRegion}
                  editable={!saving}
                  maxLength={20}
                  autoCapitalize="characters"
                  placeholder="TX"
                  accessibilityLabel="State or region, optional"
                  placeholderTextColor={COLORS.textMuted}
                />
              </View>
            </View>

            <Text style={editStyles.label}>Graduation year</Text>
            <TextInput
              style={editStyles.input}
              value={gradYear}
              onChangeText={setGradYear}
              editable={!saving}
              keyboardType="number-pad"
              maxLength={4}
              placeholder="2027"
              accessibilityLabel="Graduation year, optional. Four digits."
              placeholderTextColor={COLORS.textMuted}
            />
          </ScrollView>

          <GlowButton
            label="Save Changes"
            onPress={save}
            loading={saving}
            disabled={!isDirty}
            size="lg"
            style={{ marginTop: SPACING.lg }}
            accessibilityLabel={
              isDirty ? "Save profile changes" : "Save profile changes — nothing has changed yet"
            }
          />
          <Pressable
            onPress={requestClose}
            disabled={saving}
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
  // ── Banner + avatar preview ──────────────────────────────────────────────
  // Mirrors the real profile header layout so what's framed here is what ships.
  mediaPreview: {
    marginBottom: SPACING.xl,
  },
  bannerWrap: {
    height: 104,
    borderRadius: RADIUS.md,
    overflow: "hidden",
    backgroundColor: COLORS.surfaceDeep,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  bannerImage: { width: "100%", height: "100%" },
  bannerHint: {
    position: "absolute",
    top: SPACING.sm,
    right: SPACING.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 5,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.scrimBadge,
  },
  bannerHintText: {
    color: COLORS.white,
    fontSize: 11,
    fontWeight: FONTS.bold,
  },
  avatarWrap: {
    position: "absolute",
    left: SPACING.md,
    bottom: -SPACING.md,
    borderRadius: 40,
    borderWidth: 3,
    borderColor: COLORS.card,
    backgroundColor: COLORS.card,
  },
  avatar: { width: 64, height: 64, borderRadius: 32 },
  avatarEditBadge: {
    position: "absolute",
    bottom: -2,
    right: -6,
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
  // Capped so the sheet can't grow past the screen now that the form is longer;
  // the fields scroll inside while Save/Cancel stay pinned and reachable.
  fields: { maxHeight: 360 },
  sectionNote: {
    color: COLORS.textMuted,
    fontSize: TYPE.caption,
    lineHeight: 16,
    marginTop: SPACING.lg,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.cardBorder,
  },
  fieldRow: {
    flexDirection: "row",
    gap: SPACING.sm,
  },
  fieldGrow: { flex: 1 },
  fieldShort: { width: 96 },
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
  const {
    posts: savedPosts,
    loading: savedLoading,
    refresh: refreshSaved,
  } = useSavedPosts(userId);
  const [editVisible, setEditVisible] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [activeTab, setActiveTab] = useState<ProfileTab>("posts");
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [startingBattlePostId, setStartingBattlePostId] = useState<string | null>(null);
  const startingBattleRef = React.useRef<string | null>(null);
  const battleMutationByPostRef = React.useRef(new Map<string, CreationMutation>());
  const listRef = React.useRef<FlatList<Post | Battle>>(null);

  // Collapsing header — scroll offset lives on the UI thread only.
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  const profile = profileStore;
  // Only matched contests count. An open challenge that expired unanswered was
  // never a battle, so it must not appear in the Battles tab or inflate the
  // battle total on the header.
  const profileBattles = useMemo(
    () =>
      battles.filter(
        (battle) =>
          isCountableBattle(battle) &&
          (battle.playerA?.userId === userId ||
            battle.playerB?.userId === userId ||
            battle.creatorId === userId)
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
      // Saves can be made from the feed or a detail modal, so the Saved tab
      // needs to re-read when the athlete comes back to their profile.
      void refreshSaved();
      if (userId) {
        void fetchUserProfile(userId).then((freshProfile) => {
          if (freshProfile && canCommitProfile(userId, auth.currentUser?.uid ?? null)) {
            setProfile(freshProfile);
          }
        });
      }
    }, [refreshPosts, refreshSaved, setProfile, userId])
  );

  function handleSaved(updatedProfile: UserProfile) {
    if (userId && canCommitProfile(userId, auth.currentUser?.uid ?? null)) {
      setProfile(updatedProfile);
      refreshPosts();
    }
  }

  async function doSignOut() {
    setSigningOut(true);
    try {
      await signOut(auth);
      // Clear store immediately so the tab layout redirects to /login
      // without waiting for the onAuthStateChanged round-trip.
      clearAuth();
    } catch {
      showAlert("Error", "Could not sign out.");
    } finally {
      setSigningOut(false);
    }
  }

  // Confirmation guard — prevents accidental sign-outs from the gear tap.
  // The web/native split that used to live here now lives in utils/alert.
  async function handleSignOut() {
    const confirmed = await confirm({
      title: "Sign Out",
      message: "Are you sure you want to sign out?",
      confirmLabel: "Sign Out",
      destructive: true,
    });
    if (confirmed) void doSignOut();
  }

  async function handleBattle(post: Post) {
    if (!userId || !profile || startingBattleRef.current) return;

    startingBattleRef.current = post.id;
    setStartingBattlePostId(post.id);
    try {
      const mutation =
        battleMutationByPostRef.current.get(post.id) ??
        createCreationMutation("battle");
      battleMutationByPostRef.current.set(post.id, mutation);
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
      }, mutation);
      battleMutationByPostRef.current.delete(post.id);
      showAlert("Challenge open", "Your post is now open for challenges.");
      setSelectedPost(null);
    } catch (err) {
      console.error("Start battle from profile failed", err);
      showAlert("Failed", "Could not create battle. Please try again.");
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
    // Mirrors utils/shareBattle: identity line, a reason to open it, then a
    // deep link. Sharing bare text with no link gave recipients nothing to tap.
    const identity = [profile.sport || profile.athleteType, profile.school]
      .filter(Boolean)
      .join(" · ");
    const message = [
      `${profile.username} (${toHandle(profile.username)}) on Momentum${identity ? ` — ${identity}` : ""}.`,
      "Highlights, battles, and record — all in one place.",
      `Open in Momentum: momentum://profile/${profile.userId}`,
    ].join("\n");
    try {
      await Share.share({ title: `${profile.username} on Momentum`, message });
    } catch {
      // Share sheet unavailable (e.g. desktop web) — non-fatal.
    }
  }, [profile]);

  const isGridTab =
    activeTab === "posts" || activeTab === "highlights" || activeTab === "saved";
  const listData = useMemo<(Post | Battle)[]>(
    () =>
      activeTab === "posts"
        ? sortedPosts
        : activeTab === "highlights"
        ? highlightPosts
        : activeTab === "battles"
        ? profileBattles
        : savedPosts,
    [activeTab, highlightPosts, profileBattles, savedPosts, sortedPosts]
  );
  const renderProfileItem = useCallback(
    ({ item }: { item: Post | Battle }) =>
      isGridTab ? (
        <PostGridThumb
          post={item as Post}
          onPress={setSelectedPost}
          context="ProfileGrid"
          currentUserId={userId}
          onDeleted={() => setSelectedPost(null)}
        />
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
          ) : activeTab === "saved" && savedLoading ? (
            <ProfileGridSkeleton />
          ) : activeTab === "saved" ? (
            <EmptyState
              icon="🔖"
              title="No saved highlights yet"
              subtitle="Tap the bookmark on any highlight to keep it here. Only you can see your saves."
              actionLabel="Browse the feed"
              onAction={() => router.push("/" as never)}
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
        onDeleted={() => setSelectedPost(null)}
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
  // No paddingTop: the banner runs to the top of the safe area and the compact
  // bar floats over it, its background fading in only once the banner has
  // scrolled away. Reserving COMPACT_BAR_HEIGHT here left a black strip above
  // the banner and broke the edge-to-edge look.
  grid: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.xxxl,
    gap: SPACING.sm,
  },
  gridColumns: { gap: SPACING.sm },
});
