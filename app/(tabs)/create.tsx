import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  Image,
  Pressable,
  Alert,
  Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useAuthStore } from "@/store/authStore";
import {
  uploadMedia,
  createPost,
  MAX_POST_MEDIA_BYTES,
} from "@/hooks/usePosts";
import { createBattle } from "@/hooks/useBattles";
import {
  COLORS,
  SPACING,
  RADIUS,
  FONTS,
  BATTLE_CATEGORIES,
  BATTLE_DURATIONS,
} from "@/constants/theme";
import GlowButton from "@/components/GlowButton";
import VideoPostEditor from "@/components/VideoPostEditor";
import {
  type VideoAudioTrackId,
} from "@/constants/videoEditing";

const { width: SCREEN_W } = Dimensions.get("window");
const MEDIA_PREVIEW_H = Math.round(SCREEN_W * 0.72);

export default function CreateScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);
  const profile = useAuthStore((s) => s.profile);

  const [mediaUri, setMediaUri] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<"image" | "video">("image");
  const [selectedMedia, setSelectedMedia] = useState<
    ImagePicker.ImagePickerAsset[]
  >([]);
  const [caption, setCaption] = useState("");
  const [selectedMusic, setSelectedMusic] =
    useState<VideoAudioTrackId | null>(null);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState<number | null>(null);
  const [textOverlay, setTextOverlay] = useState("");
  const [selectedCoverUri, setSelectedCoverUri] = useState<string | null>(null);
  const [battleEnabled, setBattleEnabled] = useState(false);
  const [category, setCategory] = useState(BATTLE_CATEGORIES[0] as string);
  const [durationHours, setDurationHours] = useState(BATTLE_DURATIONS[0].hours);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);

  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function pickMedia() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        quality: 0.8,
        videoMaxDuration: 60,
        allowsEditing: false,
        aspect: [4, 3],
      });
      if (!result.canceled && result.assets.length > 0) {
        const asset = result.assets[0];
        if (
          typeof asset.fileSize === "number" &&
          asset.fileSize > MAX_POST_MEDIA_BYTES
        ) {
          Alert.alert(
            "Media too large",
            "Choose a photo or video that is 50 MB or smaller."
          );
          return;
        }
        console.log("Create Post selectedMedia[0]", asset);
        setSelectedMedia([asset]);
        setMediaUri(asset.uri);
        setMediaType(asset.type === "video" ? "video" : "image");
        setSelectedMusic(null);
        setTrimStart(0);
        setTrimEnd(null);
        setTextOverlay("");
        setSelectedCoverUri(null);
      }
    } catch (err) {
      console.error("Create media picker failed", err);
      Alert.alert("Media picker failed", "Could not select that media. Please try again.");
    }
  }

  async function handlePost() {
    if (!userId || !profile) {
      Alert.alert("Sign in required", "Please sign in to post.");
      return;
    }
    if (!mediaUri) {
      Alert.alert("Add media", "Select a photo or video to post.");
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    try {
      const mediaUrl = await uploadMedia(mediaUri, userId, setUploadProgress);

      setIsUploading(false);
      setIsSubmitting(true);

      const postId = await createPost({
        userId,
        username: profile.username,
        userAvatar: profile.avatar,
        avatarUrl: profile.avatarUrl || profile.avatar,
        mediaUrl,
        mediaType,
        caption: caption.trim(),
        battleEnabled,
        videoEdit: {
          music: selectedMusic,
          trimStart,
          trimEnd,
          textOverlay,
          coverUri: selectedCoverUri,
        },
      });

      if (battleEnabled) {
        await createBattle({
          creatorId: userId,
          playerA: {
            userId,
            username: profile.username,
            avatar: profile.avatar,
            mediaUrl,
            mediaType,
            postId,
          },
          category,
          durationHours,
        });
      }

      // Reset
      setMediaUri(null);
      setMediaType("image");
      setSelectedMedia([]);
      setCaption("");
      setSelectedMusic(null);
      setTrimStart(0);
      setTrimEnd(null);
      setTextOverlay("");
      setSelectedCoverUri(null);
      setBattleEnabled(false);
      setUploadProgress(0);

      router.replace("/");
    } catch (err) {
      console.error("Create post failed", err);
      const message =
        err instanceof Error ? err.message : "Something went wrong. Please try again.";
      Alert.alert("Post failed", message);
    } finally {
      setIsUploading(false);
      setIsSubmitting(false);
    }
  }

  const busy = isUploading || isSubmitting;
  const charCount = caption.length;
  const MAX_CAPTION = 150;
  const hasSelectedMedia = selectedMedia.length > 0;

  const thumbnailRow = (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.thumbStrip}
    >
      {hasSelectedMedia && (
        <Pressable onPress={pickMedia} style={styles.thumbItem}>
          {mediaType === "image" ? (
            <Image
              source={{ uri: selectedMedia[0].uri }}
              style={styles.thumbImage}
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.thumbImage, styles.thumbVideo]}>
              <Text style={styles.thumbVideoIcon}>▶</Text>
            </View>
          )}
          {mediaType === "video" && (
            <View style={styles.thumbBadge}>
              <Text style={styles.thumbBadgeText}>0:08</Text>
            </View>
          )}
        </Pressable>
      )}
      <Pressable onPress={pickMedia} style={styles.thumbAdd}>
        <Text style={styles.thumbAddIcon}>+</Text>
      </Pressable>
    </ScrollView>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>

      {/* ── Top bar: ✕  Create Post  Next ─────────────────────────────────── */}
      <View style={styles.topBar}>
        <Pressable
          onPress={() => router.replace("/")}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.topBarClose}
        >
          <Text style={styles.closeIcon}>✕</Text>
        </Pressable>
        <Text style={styles.topBarTitle}>Create Post</Text>
        <Pressable
          onPress={handlePost}
          disabled={!mediaUri || busy}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.topBarNext}
        >
          <Text style={[styles.nextLabel, (!mediaUri || busy) && styles.nextLabelDisabled]}>
            {isUploading ? `${uploadProgress}%` : isSubmitting ? "Posting…" : "Next"}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Large media preview ──────────────────────────────────────────── */}
        <Pressable
          onPress={pickMedia}
          disabled={busy}
          style={[styles.mediaPicker, !!mediaUri && styles.mediaPickerFilled]}
        >
          {mediaUri ? (
            <>
              {mediaType === "video" ? (
                <View style={[styles.mediaPreview, styles.videoPreview]}>
                  <View style={styles.playBadge}>
                    <Text style={styles.videoPreviewIcon}>▶</Text>
                  </View>
                  <Text style={styles.videoPreviewLabel}>Video ready</Text>
                </View>
              ) : (
                <Image source={{ uri: mediaUri }} style={styles.mediaPreview} resizeMode="cover" />
              )}
              <View style={styles.changeOverlay}>
                <Text style={styles.changeText}>Tap to change</Text>
              </View>
            </>
          ) : (
            <View style={styles.mediaPlaceholder}>
              <Text style={styles.mediaIcon}>📷</Text>
              <Text style={styles.mediaLabel}>Tap to add photo or video</Text>
            </View>
          )}
        </Pressable>

        {/* ── Thumbnail strip (selected + add more) ───────────────────────── */}
        {thumbnailRow}

        {selectedMedia.length > 0 && (
          <>
            <VideoPostEditor
              uri={selectedMedia[0].uri}
              selectedMusic={selectedMusic}
              onSelectedMusicChange={setSelectedMusic}
              trimStart={trimStart}
              onTrimStartChange={setTrimStart}
              trimEnd={trimEnd}
              onTrimEndChange={setTrimEnd}
              textOverlay={textOverlay}
              onTextOverlayChange={setTextOverlay}
              selectedCoverUri={selectedCoverUri}
              onSelectedCoverUriChange={setSelectedCoverUri}
              showPreview={false}
              disabled={busy}
            />
          </>
        )}

        {/* ── Caption ─────────────────────────────────────────────────────── */}
        <View style={styles.captionWrap}>
          <TextInput
            style={styles.captionInput}
            placeholder={"All gas no brakes. Playoff time 😤\n\n#football #playoffs #momentum"}
            placeholderTextColor={COLORS.textMuted}
            multiline
            maxLength={MAX_CAPTION}
            value={caption}
            onChangeText={setCaption}
            editable={!busy}
          />
          <Text style={styles.charCount}>{charCount}/{MAX_CAPTION}</Text>
        </View>

        {/* ── Add to Battle toggle ─────────────────────────────────────────── */}
        <Pressable
          onPress={() => setBattleEnabled((v) => !v)}
          disabled={busy}
          style={[styles.battleToggle, battleEnabled && styles.battleToggleActive]}
        >
          <Text style={[styles.battleToggleLabel, battleEnabled && styles.battleToggleLabelActive]}>
            Add to Battle
          </Text>
          <View style={[styles.togglePill, battleEnabled && styles.togglePillActive]}>
            <View style={[styles.toggleDot, battleEnabled && styles.toggleDotActive]} />
          </View>
        </Pressable>

        {/* ── Battle options ───────────────────────────────────────────────── */}
        {battleEnabled && (
          <View style={styles.battleOptions}>
            {/* Category row — chevron style matching mockup */}
            <Pressable
              style={styles.categoryRow}
              onPress={() => setCategoryPickerOpen((v) => !v)}
            >
              <View>
                <Text style={styles.categoryLabel}>Battle Category</Text>
                <Text style={styles.categoryValue}>{category}</Text>
              </View>
              <Text style={styles.categoryChevron}>›</Text>
            </Pressable>

            {/* Category picker (inline chips, shown when row tapped) */}
            {categoryPickerOpen && (
              <View style={styles.chipGrid}>
                {BATTLE_CATEGORIES.map((c) => (
                  <Pressable
                    key={c}
                    style={[styles.chip, category === c && styles.chipActive]}
                    onPress={() => { setCategory(c); setCategoryPickerOpen(false); }}
                  >
                    <Text style={[styles.chipText, category === c && styles.chipTextActive]}>{c}</Text>
                  </Pressable>
                ))}
              </View>
            )}

            {/* Duration */}
            <Text style={styles.sectionLabel}>Duration</Text>
            <View style={styles.chipRow}>
              {BATTLE_DURATIONS.map((d) => (
                <Pressable
                  key={d.hours}
                  style={[styles.chip, durationHours === d.hours && styles.chipActive]}
                  onPress={() => setDurationHours(d.hours)}
                >
                  <Text style={[styles.chipText, durationHours === d.hours && styles.chipTextActive]}>
                    {d.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* ── Upload progress ──────────────────────────────────────────────── */}
        {isUploading && (
          <View style={styles.progressSection}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { flex: uploadProgress }]} />
              <View style={{ flex: Math.max(0, 100 - uploadProgress) }} />
            </View>
            <Text style={styles.progressText}>Uploading… {uploadProgress}%</Text>
          </View>
        )}
      </ScrollView>

      {/* ── Post button (bottom, shown when Next is not used) ───────────────── */}
      <View style={styles.footer}>
        <GlowButton
          label={
            isUploading
              ? `Uploading ${uploadProgress}%`
              : isSubmitting
              ? "Posting…"
              : battleEnabled
              ? "Post & Open Challenge"
              : "Post"
          }
          onPress={handlePost}
          loading={busy}
          disabled={!mediaUri || busy}
          size="lg"
          style={styles.submitBtn}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  scroll: { flex: 1 },
  content: { paddingBottom: 180, gap: SPACING.sm },

  // ── Top bar ────────────────────────────────────────────────────────────────
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
  },
  topBarClose: {
    width: 36,
    alignItems: "flex-start",
  },
  closeIcon: {
    color: COLORS.textSecondary,
    fontSize: 18,
    fontWeight: FONTS.bold,
  },
  topBarTitle: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: FONTS.heavy,
    letterSpacing: 0.4,
  },
  topBarNext: {
    width: 50,
    alignItems: "flex-end",
  },
  nextLabel: {
    color: COLORS.accent,
    fontSize: 16,
    fontWeight: FONTS.bold,
  },
  nextLabelDisabled: {
    color: COLORS.textMuted,
  },

  // ── Media picker ───────────────────────────────────────────────────────────
  mediaPicker: {
    height: MEDIA_PREVIEW_H,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1.5,
    borderColor: COLORS.inputBorder,
    borderStyle: "dashed",
    backgroundColor: COLORS.surface,
    overflow: "hidden",
  },
  mediaPickerFilled: {
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: COLORS.cardBorder,
  },
  mediaPreview: { width: "100%", height: "100%" },
  videoPreview: {
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.sm,
    backgroundColor: "#0a0a0a",
  },
  playBadge: {
    width: 64, height: 64, borderRadius: 32,
    alignItems: "center", justifyContent: "center",
    backgroundColor: COLORS.accentFaint, borderWidth: 1, borderColor: COLORS.accent,
  },
  videoPreviewIcon: { color: COLORS.accent, fontSize: 28, marginLeft: 3 },
  videoPreviewLabel: { color: COLORS.textSecondary, fontSize: 14, fontWeight: FONTS.semibold },
  changeOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  changeText: { color: COLORS.white, fontWeight: FONTS.bold, fontSize: 14 },
  mediaPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", gap: SPACING.md },
  mediaIcon: { fontSize: 48 },
  mediaLabel: { color: COLORS.textSecondary, fontSize: 16, fontWeight: FONTS.semibold },

  // ── Thumbnail strip ────────────────────────────────────────────────────────
  thumbStrip: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    gap: SPACING.md,
    flexDirection: "row",
    alignItems: "center",
  },
  thumbItem: {
    width: 76,
    height: 76,
    borderRadius: RADIUS.md,
    overflow: "hidden",
    position: "relative",
    borderWidth: 2,
    borderColor: COLORS.accent,
  },
  thumbImage: { width: "100%", height: "100%" },
  thumbVideo: {
    backgroundColor: "#0a0a0a",
    alignItems: "center",
    justifyContent: "center",
  },
  thumbVideoIcon: { color: COLORS.accent, fontSize: 22 },
  thumbBadge: {
    position: "absolute",
    bottom: 4,
    left: 4,
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: RADIUS.xs,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  thumbBadgeText: { color: COLORS.white, fontSize: 10, fontWeight: FONTS.bold },
  thumbAdd: {
    width: 76, height: 76,
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    borderColor: COLORS.inputBorder,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surface,
  },
  thumbAddIcon: {
    color: COLORS.textMuted,
    fontSize: 26,
    fontWeight: FONTS.light,
    lineHeight: 30,
  },

  // ── Caption ────────────────────────────────────────────────────────────────
  captionWrap: {
    marginHorizontal: SPACING.lg,
    backgroundColor: COLORS.input,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  captionInput: {
    color: COLORS.textPrimary,
    fontSize: 15,
    lineHeight: 21,
    minHeight: 96,
    textAlignVertical: "top",
  },
  charCount: {
    color: COLORS.textMuted,
    fontSize: 11,
    textAlign: "right",
    marginTop: SPACING.xs,
  },

  // ── Battle toggle ──────────────────────────────────────────────────────────
  battleToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: SPACING.lg,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md + 2,
  },
  battleToggleActive: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accentFaint,
  },
  battleToggleLabel: {
    color: COLORS.textSecondary,
    fontSize: 16,
    fontWeight: FONTS.semibold,
  },
  battleToggleLabelActive: { color: COLORS.textPrimary, fontWeight: FONTS.bold },
  togglePill: {
    width: 48, height: 28, borderRadius: 14,
    backgroundColor: COLORS.inputBorder,
    padding: 3, justifyContent: "center",
  },
  togglePillActive: { backgroundColor: COLORS.accent },
  toggleDot: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: COLORS.white, alignSelf: "flex-start",
  },
  toggleDotActive: { alignSelf: "flex-end" },

  // ── Battle options ─────────────────────────────────────────────────────────
  battleOptions: {
    marginHorizontal: SPACING.lg,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    overflow: "hidden",
  },
  categoryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
  },
  categoryLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: FONTS.bold,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  categoryValue: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: FONTS.semibold,
  },
  categoryChevron: {
    color: COLORS.textMuted,
    fontSize: 22,
    fontWeight: FONTS.light,
  },
  chipGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACING.sm,
    padding: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
  },
  sectionLabel: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: FONTS.bold,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
  },
  chip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    backgroundColor: COLORS.background,
  },
  chipActive: { backgroundColor: COLORS.accentFaint, borderColor: COLORS.accent },
  chipText: { color: COLORS.textMuted, fontSize: 13, fontWeight: FONTS.medium },
  chipTextActive: { color: COLORS.accent, fontWeight: FONTS.bold },

  // ── Upload progress ────────────────────────────────────────────────────────
  progressSection: { marginHorizontal: SPACING.lg, gap: SPACING.xs },
  progressTrack: {
    flexDirection: "row",
    height: 4,
    backgroundColor: COLORS.inputBorder,
    borderRadius: RADIUS.full,
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: COLORS.accent },
  progressText: { color: COLORS.textMuted, fontSize: 12, textAlign: "center" },

  // ── Footer ─────────────────────────────────────────────────────────────────
  footer: {
    borderTopWidth: 1,
    borderTopColor: COLORS.cardBorder,
    backgroundColor: COLORS.background,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.lg,
  },
  submitBtn: {},
});
