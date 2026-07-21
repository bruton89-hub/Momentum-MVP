import React, { useCallback, useMemo, useRef, useState } from "react";
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
  Platform,
  Linking,
  KeyboardAvoidingView,
  Keyboard,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { ResizeMode, Video } from "expo-av";
import { useRouter } from "expo-router";
import Animated, { FadeIn, ZoomIn, useReducedMotion } from "react-native-reanimated";
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
  TYPE,
  HIT_SLOP,
  GLOW,
  ATHLETE_TYPES,
  BATTLE_CATEGORIES,
  BATTLE_DURATIONS,
} from "@/constants/theme";
import GlowButton from "@/components/GlowButton";
import Chip from "@/components/Chip";
import IconButton from "@/components/IconButton";
import VideoPostEditor from "@/components/VideoPostEditor";
import {
  type VideoAudioTrackId,
} from "@/constants/videoEditing";

const { width: SCREEN_W } = Dimensions.get("window");
const MEDIA_PREVIEW_H = Math.round(SCREEN_W * 0.9);
const MAX_CAPTION = 150;

/** "83000" ms → "1:23". ImagePicker durations are in milliseconds. */
function formatDuration(ms?: number | null): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return null;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function CreateScreen() {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
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

  // ── Optional athlete context (all optional; written only when provided).
  // Sport prefills from the profile — the athlete can change or clear it.
  const profileSport = profile?.sport || profile?.athleteType || "";
  const [sport, setSport] = useState<string | null>(
    (ATHLETE_TYPES as readonly string[]).includes(profileSport) ? profileSport : null
  );
  const [position, setPosition] = useState("");
  const [school, setSchool] = useState("");

  // ── Video preview state — single muted player, tap to play/pause.
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewMuted, setPreviewMuted] = useState(true);

  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [publishedWithChallenge, setPublishedWithChallenge] = useState(false);
  const publishingRef = useRef(false);

  const busy = isUploading || isSubmitting;
  const hasUnsavedWork =
    !!mediaUri || !!caption.trim() || !!position.trim() || !!school.trim();
  const videoDuration = formatDuration(selectedMedia[0]?.duration);

  function showPermissionAlert() {
    Alert.alert(
      "Photo access needed",
      "Momentum needs access to your photo library so you can choose a highlight to upload. You can enable it in Settings.",
      Platform.OS === "web"
        ? [{ text: "OK" }]
        : [
            { text: "Not now", style: "cancel" },
            {
              text: "Open Settings",
              onPress: () => {
                Linking.openSettings().catch(() => undefined);
              },
            },
          ]
    );
  }

  async function pickMedia() {
    try {
      // Recovery path for previously-denied access on native. We deliberately
      // do NOT pre-request permission (the system picker handles it), so a
      // fresh install behaves exactly as before.
      if (Platform.OS !== "web") {
        const perm = await ImagePicker.getMediaLibraryPermissionsAsync();
        if (!perm.granted && !perm.canAskAgain) {
          showPermissionAlert();
          return;
        }
      }

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
        setSelectedMedia([asset]);
        setMediaUri(asset.uri);
        setMediaType(asset.type === "video" ? "video" : "image");
        setSelectedMusic(null);
        setTrimStart(0);
        setTrimEnd(null);
        setTextOverlay("");
        setSelectedCoverUri(null);
        setPreviewPlaying(false);
        setPreviewMuted(true);
      }
    } catch (err) {
      console.error("Create media picker failed", err);
      Alert.alert("Media picker failed", "Could not select that media. Please try again.");
    }
  }

  const removeMedia = useCallback(() => {
    setSelectedMedia([]);
    setMediaUri(null);
    setMediaType("image");
    setSelectedMusic(null);
    setTrimStart(0);
    setTrimEnd(null);
    setTextOverlay("");
    setSelectedCoverUri(null);
    setPreviewPlaying(false);
  }, []);

  function resetForm() {
    removeMedia();
    setCaption("");
    setBattleEnabled(false);
    setCategoryPickerOpen(false);
    setPosition("");
    setSchool("");
    setUploadProgress(0);
  }

  // ── Exit confirmation — never silently discard selected media or text. ─────
  function handleClose() {
    if (busy) return; // publish in flight — don't abandon it
    if (!hasUnsavedWork) {
      router.replace("/");
      return;
    }
    if (Platform.OS === "web") {
      const confirmed =
        typeof window !== "undefined" && typeof window.confirm === "function"
          ? window.confirm("Discard this highlight? Your media and details will be lost.")
          : true;
      if (confirmed) router.replace("/");
      return;
    }
    Alert.alert("Discard highlight?", "Your selected media and details will be lost.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => router.replace("/") },
    ]);
  }

  async function handlePost() {
    if (busy || publishingRef.current) return;
    if (!userId || !profile) {
      Alert.alert("Sign in required", "Please sign in to post.");
      return;
    }
    if (!mediaUri) {
      Alert.alert("Add media", "Select a photo or video to post.");
      return;
    }

    Keyboard.dismiss();
    publishingRef.current = true;
    setIsUploading(true);
    setUploadProgress(0);

    try {
      const mediaUrl = await uploadMedia(mediaUri, userId, setUploadProgress);

      setIsUploading(false);
      setIsSubmitting(true);

      const postId = await createPost({
        userId,
        username: profile.username,
        userAvatar: profile.avatarUrl || profile.avatar,
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
        sport: sport ?? undefined,
        position,
        school,
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

      // Success — confirm before navigating anywhere.
      setPublishedWithChallenge(battleEnabled);
      resetForm();
      setShowSuccess(true);
    } catch (err) {
      // Recoverable failure — media, caption, and details all stay in state.
      console.error("Create post failed", err);
      const message =
        err instanceof Error ? err.message : "Something went wrong. Please try again.";
      Alert.alert(
        "Couldn't publish",
        `${message}\n\nYour highlight and details are still here — you can retry.`
      );
    } finally {
      publishingRef.current = false;
      setIsUploading(false);
      setIsSubmitting(false);
    }
  }

  const publishLabel = isUploading
    ? `Uploading ${uploadProgress}%`
    : isSubmitting
    ? "Finishing Post…"
    : battleEnabled
    ? "Publish & Open Challenge"
    : "Publish Highlight";

  const durationLabel = useMemo(
    () => BATTLE_DURATIONS.find((d) => d.hours === durationHours)?.label ?? `${durationHours}h`,
    [durationHours]
  );

  // ── Success state — shown before any navigation happens ────────────────────
  if (showSuccess) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.successWrap}>
          <Animated.View
            entering={reducedMotion ? undefined : ZoomIn.duration(320)}
            style={styles.successCheck}
          >
            <Feather name="check" size={44} color={COLORS.black} />
          </Animated.View>
          <Animated.View
            entering={reducedMotion ? undefined : FadeIn.duration(300).delay(120)}
            style={styles.successTextWrap}
          >
            <Text style={styles.successTitle} accessibilityRole="header">
              Highlight published
            </Text>
            <Text style={styles.successSub}>
              {publishedWithChallenge
                ? "Your post is live and your challenge is open — athletes can now accept it."
                : "Your post is live on the feed."}
            </Text>
          </Animated.View>
          <View style={styles.successActions}>
            <GlowButton
              label="Return to Feed"
              onPress={() => {
                setShowSuccess(false);
                router.replace("/");
              }}
              size="lg"
              accessibilityLabel="Return to the feed"
            />
            <GlowButton
              label="Upload Another"
              onPress={() => setShowSuccess(false)}
              variant="secondary"
              accessibilityLabel="Upload another highlight"
            />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>

      {/* ── Top bar: ✕  New Highlight  Publish ─────────────────────────────── */}
      <View style={styles.topBar}>
        <View style={styles.topBarClose}>
          <IconButton
            icon="x"
            variant="plain"
            accessibilityLabel={hasUnsavedWork ? "Close — you'll be asked to confirm" : "Close and return home"}
            onPress={handleClose}
          />
        </View>
        <Text style={styles.topBarTitle} accessibilityRole="header">New Highlight</Text>
        <Pressable
          onPress={handlePost}
          disabled={!mediaUri || busy}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Publish highlight"
          accessibilityState={{ disabled: !mediaUri || busy, busy }}
          style={({ pressed }) => [styles.topBarNext, pressed && { opacity: 0.7 }]}
        >
          <Text style={[styles.nextLabel, (!mediaUri || busy) && styles.nextLabelDisabled]}>
            {isUploading ? `${uploadProgress}%` : isSubmitting ? "Saving…" : "Publish"}
          </Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={styles.scroll}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Stage 1 · Media ─────────────────────────────────────────────── */}
          {mediaUri ? (
            <Animated.View
              entering={reducedMotion ? undefined : FadeIn.duration(250)}
              style={styles.mediaCard}
            >
              {mediaType === "video" ? (
                <Pressable
                  onPress={() => setPreviewPlaying((p) => !p)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    previewPlaying ? "Pause video preview" : "Play video preview"
                  }
                  style={styles.mediaPreview}
                >
                  <Video
                    source={{ uri: mediaUri }}
                    style={styles.mediaFill}
                    resizeMode={ResizeMode.COVER}
                    shouldPlay={previewPlaying}
                    isLooping
                    isMuted={previewMuted}
                    useNativeControls={false}
                  />
                  {!previewPlaying && (
                    <View style={styles.playBadge} pointerEvents="none">
                      <Feather name="play" size={28} color={COLORS.accent} style={{ marginLeft: 3 }} />
                    </View>
                  )}
                  {/* Duration — only when the picker actually reported one */}
                  {videoDuration && (
                    <View style={styles.durationBadge} pointerEvents="none">
                      <Feather name="film" size={10} color={COLORS.white} />
                      <Text style={styles.durationText}>{videoDuration}</Text>
                    </View>
                  )}
                </Pressable>
              ) : (
                <Image source={{ uri: mediaUri }} style={styles.mediaPreview} resizeMode="cover" />
              )}

              {/* Mute toggle — SIBLING of the play/pause pressable, absolutely
                  positioned over it. On web the preview renders as a <button>,
                  so nesting this button inside it would be invalid DOM. */}
              {mediaType === "video" && (
                <Pressable
                  onPress={() => setPreviewMuted((m) => !m)}
                  hitSlop={HIT_SLOP}
                  accessibilityRole="button"
                  accessibilityLabel={previewMuted ? "Unmute preview" : "Mute preview"}
                  style={styles.muteBtn}
                >
                  <Feather
                    name={previewMuted ? "volume-x" : "volume-2"}
                    size={14}
                    color={COLORS.white}
                  />
                </Pressable>
              )}

              {/* Replace / Remove */}
              <View style={styles.mediaActions}>
                <Pressable
                  onPress={pickMedia}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={mediaType === "video" ? "Replace selected video" : "Replace selected photo"}
                  style={({ pressed }) => [styles.mediaActionBtn, pressed && { opacity: 0.75 }]}
                >
                  <Feather name="refresh-cw" size={13} color={COLORS.textPrimary} />
                  <Text style={styles.mediaActionText}>Replace</Text>
                </Pressable>
                <Pressable
                  onPress={removeMedia}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel="Remove selected media"
                  style={({ pressed }) => [styles.mediaActionBtn, pressed && { opacity: 0.75 }]}
                >
                  <Feather name="trash-2" size={13} color={COLORS.error} />
                  <Text style={[styles.mediaActionText, { color: COLORS.error }]}>Remove</Text>
                </Pressable>
              </View>
            </Animated.View>
          ) : (
            /* Premium empty state */
            <Pressable
              onPress={pickMedia}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Choose a video or photo highlight"
              style={({ pressed }) => [styles.emptyPicker, pressed && { opacity: 0.85 }]}
            >
              <View style={styles.emptyIconRing}>
                <Feather name="upload" size={34} color={COLORS.accent} />
              </View>
              <Text style={styles.emptyTitle}>Add a highlight</Text>
              <Text style={styles.emptyHint}>
                Photos and videos up to 50 MB · videos up to 60 seconds
              </Text>
              {/* Presentational CTA — the WHOLE tile is the button. Rendering a
                  real GlowButton here would nest <button> inside <button> on
                  web (validateDOMNesting). Styled to match GlowButton primary. */}
              <View
                style={styles.emptyCta}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <Text style={styles.emptyCtaText}>Choose from Library</Text>
              </View>
            </Pressable>
          )}

          {/* ── Stage 2 · Video tools (existing editor — videos only) ───────── */}
          {selectedMedia.length > 0 && mediaType === "video" && (
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
          )}

          {/* ── Stage 3 · Highlight details (all optional) ─────────────────── */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Highlight details</Text>
              <Text style={styles.sectionOptional}>Optional</Text>
            </View>

            {/* Sport — real option list from ATHLETE_TYPES, prefilled from profile */}
            <Text style={styles.fieldLabel} nativeID="create-sport-label">Sport</Text>
            <View style={styles.chipGridPlain}>
              {ATHLETE_TYPES.map((t) => (
                <Chip
                  key={t}
                  label={t}
                  selected={sport === t}
                  onPress={() => setSport((current) => (current === t ? null : t))}
                  disabled={busy}
                />
              ))}
            </View>

            {/* Position */}
            <Text style={styles.fieldLabel} nativeID="create-position-label">Position</Text>
            <TextInput
              style={styles.fieldInput}
              placeholder="e.g. QB, Point Guard"
              placeholderTextColor={COLORS.textMuted}
              value={position}
              onChangeText={setPosition}
              editable={!busy}
              maxLength={40}
              accessibilityLabel="Position, optional"
              accessibilityLabelledBy="create-position-label"
            />

            {/* School / team */}
            <Text style={styles.fieldLabel} nativeID="create-school-label">School or team</Text>
            <TextInput
              style={styles.fieldInput}
              placeholder="e.g. Lincoln High"
              placeholderTextColor={COLORS.textMuted}
              value={school}
              onChangeText={setSchool}
              editable={!busy}
              maxLength={60}
              accessibilityLabel="School or team, optional"
              accessibilityLabelledBy="create-school-label"
            />

            {/* Caption */}
            <Text style={styles.fieldLabel} nativeID="create-caption-label">Caption</Text>
            <View style={styles.captionWrap}>
              <TextInput
                style={styles.captionInput}
                placeholder={"All gas no brakes. Playoff time 😤\n#football #playoffs #momentum"}
                placeholderTextColor={COLORS.textMuted}
                multiline
                maxLength={MAX_CAPTION}
                value={caption}
                onChangeText={setCaption}
                editable={!busy}
                accessibilityLabel="Caption, optional. Hashtags are highlighted in the feed."
                accessibilityLabelledBy="create-caption-label"
              />
              <Text style={styles.charCount}>{caption.length}/{MAX_CAPTION}</Text>
            </View>
          </View>

          {/* ── Stage 4 · Challenge availability ───────────────────────────── */}
          <View style={[styles.sectionCard, battleEnabled && styles.challengeCardActive]}>
            <Pressable
              onPress={() => setBattleEnabled((v) => !v)}
              disabled={busy}
              accessibilityRole="switch"
              accessibilityLabel="Open this highlight for challenges"
              accessibilityState={{ checked: battleEnabled, disabled: busy }}
              style={({ pressed }) => [styles.challengeRow, pressed && { opacity: 0.85 }]}
            >
              <View style={styles.challengeIconWrap}>
                <MaterialCommunityIcons
                  name="sword-cross"
                  size={18}
                  color={battleEnabled ? COLORS.accent : COLORS.textMuted}
                />
              </View>
              <View style={styles.challengeTextWrap}>
                <Text style={[styles.challengeTitle, battleEnabled && { color: COLORS.textPrimary }]}>
                  Open for Challenge
                </Text>
                <Text style={styles.challengeSub}>
                  {battleEnabled
                    ? `Publishing creates an open ${durationLabel.toLowerCase()} challenge — any athlete can accept it and the community votes.`
                    : "Let other athletes battle this highlight. Off by default."}
                </Text>
              </View>
              <View style={[styles.togglePill, battleEnabled && styles.togglePillActive]}>
                <View style={[styles.toggleDot, battleEnabled && styles.toggleDotActive]} />
              </View>
            </Pressable>

            {/* Battle options */}
            {battleEnabled && (
              <View style={styles.battleOptions}>
                <Pressable
                  style={({ pressed }) => [styles.categoryRow, pressed && { opacity: 0.8 }]}
                  onPress={() => setCategoryPickerOpen((v) => !v)}
                  accessibilityRole="button"
                  accessibilityLabel={`Battle category: ${category}. Tap to change.`}
                  accessibilityState={{ expanded: categoryPickerOpen }}
                >
                  <View>
                    <Text style={styles.categoryLabel}>Battle Category</Text>
                    <Text style={styles.categoryValue}>{category}</Text>
                  </View>
                  <Feather
                    name={categoryPickerOpen ? "chevron-down" : "chevron-right"}
                    size={20}
                    color={COLORS.textMuted}
                  />
                </Pressable>

                {categoryPickerOpen && (
                  <View style={styles.chipGrid}>
                    {BATTLE_CATEGORIES.map((c) => (
                      <Chip
                        key={c}
                        label={c}
                        selected={category === c}
                        onPress={() => { setCategory(c); setCategoryPickerOpen(false); }}
                        disabled={busy}
                      />
                    ))}
                  </View>
                )}

                <Text style={styles.sectionLabel}>Duration</Text>
                <View style={styles.chipRow}>
                  {BATTLE_DURATIONS.map((d) => (
                    <Chip
                      key={d.hours}
                      label={d.label}
                      selected={durationHours === d.hours}
                      onPress={() => setDurationHours(d.hours)}
                      disabled={busy}
                    />
                  ))}
                </View>
              </View>
            )}
          </View>

          {/* ── Safety reminder — short and non-blocking ────────────────────── */}
          <Text style={styles.safetyNote}>
            Only upload footage you have permission to share, and avoid exposing
            private personal information. Posts are visible to everyone on Momentum.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Publish footer ──────────────────────────────────────────────────── */}
      <View style={styles.footer}>
        {/* Upload progress — real values only, layout-stable */}
        {busy && (
          <View style={styles.progressSection} accessible accessibilityLabel={
            isUploading ? `Upload progress, ${uploadProgress} percent` : "Saving post"
          }>
            {mediaUri && mediaType === "image" ? (
              <Image source={{ uri: mediaUri }} style={styles.progressThumb} />
            ) : (
              <View style={[styles.progressThumb, styles.progressThumbVideo]}>
                <Feather name="film" size={14} color={COLORS.accent} />
              </View>
            )}
            <View style={styles.progressBody}>
              <Text style={styles.progressStage}>
                {isUploading ? `Uploading highlight · ${uploadProgress}%` : "Saving post…"}
              </Text>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { flex: isUploading ? Math.max(uploadProgress, 2) : 100 },
                  ]}
                />
                <View style={{ flex: isUploading ? Math.max(0, 100 - uploadProgress) : 0 }} />
              </View>
            </View>
          </View>
        )}

        <GlowButton
          label={publishLabel}
          onPress={handlePost}
          loading={busy}
          disabled={!mediaUri || busy}
          size="lg"
          accessibilityLabel={
            !mediaUri ? "Publish highlight — add media first" : "Publish highlight"
          }
        />
        {!mediaUri && !busy && (
          <Text style={styles.disabledReason}>Add a photo or video to publish.</Text>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  scroll: { flex: 1 },
  content: { paddingBottom: SPACING.xl, gap: SPACING.md },

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
    width: 44,
    alignItems: "flex-start",
  },
  topBarTitle: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: FONTS.heavy,
    letterSpacing: 0.4,
  },
  topBarNext: {
    minWidth: 60,
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

  // ── Empty media picker ─────────────────────────────────────────────────────
  emptyPicker: {
    minHeight: MEDIA_PREVIEW_H * 0.8,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1.5,
    borderColor: COLORS.inputBorder,
    borderStyle: "dashed",
    backgroundColor: COLORS.surface,
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.sm,
    padding: SPACING.xl,
  },
  emptyIconRing: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 1.5,
    borderColor: COLORS.accentBorderFaint,
    backgroundColor: COLORS.accentFaint,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: SPACING.sm,
  },
  emptyTitle: {
    color: COLORS.textPrimary,
    fontSize: 20,
    fontWeight: FONTS.extrabold,
    letterSpacing: 0.2,
  },
  emptyHint: {
    color: COLORS.textMuted,
    fontSize: TYPE.small,
    textAlign: "center",
    lineHeight: 17,
  },
  // Mirrors GlowButton primary/md styling (accent fill, heavy black label,
  // neon glow) — presentational only; the surrounding tile is the button.
  emptyCta: {
    marginTop: SPACING.md,
    minWidth: 200,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.accent,
    paddingVertical: 12,
    paddingHorizontal: SPACING.lg,
    ...GLOW.accent,
  },
  emptyCtaText: {
    color: COLORS.black,
    fontWeight: FONTS.heavy,
    fontSize: TYPE.base,
  },

  // ── Media preview card ─────────────────────────────────────────────────────
  mediaCard: {
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.surfaceDeep,
    overflow: "hidden",
  },
  mediaPreview: {
    width: "100%",
    height: MEDIA_PREVIEW_H,
    backgroundColor: COLORS.surfaceDeep,
  },
  mediaFill: { width: "100%", height: "100%" },
  playBadge: {
    position: "absolute",
    alignSelf: "center",
    top: "50%",
    marginTop: -32,
    width: 64, height: 64, borderRadius: 32,
    alignItems: "center", justifyContent: "center",
    backgroundColor: COLORS.scrimBadge, borderWidth: 1, borderColor: COLORS.accent,
  },
  durationBadge: {
    position: "absolute",
    top: SPACING.sm,
    left: SPACING.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.scrimBadge,
    borderRadius: RADIUS.xs,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  durationText: {
    color: COLORS.white,
    fontSize: TYPE.micro,
    fontWeight: FONTS.bold,
  },
  muteBtn: {
    position: "absolute",
    top: SPACING.sm,
    right: SPACING.sm,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: COLORS.scrimBadge,
    alignItems: "center",
    justifyContent: "center",
  },
  mediaActions: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: COLORS.cardBorder,
    backgroundColor: COLORS.card,
  },
  mediaActionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: SPACING.md,
    minHeight: 44,
  },
  mediaActionText: {
    color: COLORS.textPrimary,
    fontSize: TYPE.footnote,
    fontWeight: FONTS.semibold,
  },

  // ── Section cards ──────────────────────────────────────────────────────────
  sectionCard: {
    marginHorizontal: SPACING.lg,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: SPACING.lg,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: SPACING.sm,
  },
  sectionTitle: {
    color: COLORS.textPrimary,
    fontSize: TYPE.callout,
    fontWeight: FONTS.heavy,
    letterSpacing: 0.2,
  },
  sectionOptional: {
    color: COLORS.textMuted,
    fontSize: TYPE.caption,
    fontWeight: FONTS.semibold,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  fieldLabel: {
    color: COLORS.textSecondary,
    fontSize: TYPE.caption,
    fontWeight: FONTS.bold,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: SPACING.md,
    marginBottom: SPACING.xs,
  },
  fieldInput: {
    backgroundColor: COLORS.input,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: RADIUS.md,
    color: COLORS.textPrimary,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    fontSize: TYPE.base,
  },
  chipGridPlain: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACING.sm,
  },

  // ── Caption ────────────────────────────────────────────────────────────────
  captionWrap: {
    backgroundColor: COLORS.input,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xs,
  },
  captionInput: {
    color: COLORS.textPrimary,
    fontSize: 15,
    lineHeight: 21,
    minHeight: 88,
    textAlignVertical: "top",
  },
  charCount: {
    color: COLORS.textMuted,
    fontSize: 11,
    textAlign: "right",
    marginTop: SPACING.xs,
  },

  // ── Challenge card ─────────────────────────────────────────────────────────
  challengeCardActive: {
    borderColor: COLORS.accentBorderFaint,
    backgroundColor: COLORS.surfaceRaised,
  },
  challengeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
  },
  challengeIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  challengeTextWrap: { flex: 1, gap: 2 },
  challengeTitle: {
    color: COLORS.textSecondary,
    fontSize: TYPE.callout,
    fontWeight: FONTS.bold,
  },
  challengeSub: {
    color: COLORS.textMuted,
    fontSize: TYPE.small,
    lineHeight: 16,
  },
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
    marginTop: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
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

  // ── Safety note ────────────────────────────────────────────────────────────
  safetyNote: {
    color: COLORS.textMuted,
    fontSize: TYPE.caption,
    lineHeight: 16,
    textAlign: "center",
    marginHorizontal: SPACING.xl,
  },

  // ── Progress ───────────────────────────────────────────────────────────────
  progressSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
    marginBottom: SPACING.md,
  },
  progressThumb: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.surface,
  },
  progressThumbVideo: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  progressBody: { flex: 1, gap: 6 },
  progressStage: {
    color: COLORS.textSecondary,
    fontSize: TYPE.small,
    fontWeight: FONTS.semibold,
  },
  progressTrack: {
    flexDirection: "row",
    height: 5,
    backgroundColor: COLORS.inputBorder,
    borderRadius: RADIUS.full,
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: COLORS.accent },

  // ── Footer ─────────────────────────────────────────────────────────────────
  footer: {
    borderTopWidth: 1,
    borderTopColor: COLORS.cardBorder,
    backgroundColor: COLORS.background,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.lg,
  },
  disabledReason: {
    color: COLORS.textMuted,
    fontSize: TYPE.caption,
    textAlign: "center",
    marginTop: SPACING.sm,
  },

  // ── Success state ──────────────────────────────────────────────────────────
  successWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: SPACING.xl,
    gap: SPACING.lg,
  },
  successCheck: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: COLORS.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  successTextWrap: {
    alignItems: "center",
    gap: SPACING.sm,
  },
  successTitle: {
    color: COLORS.textPrimary,
    fontSize: 24,
    fontWeight: FONTS.heavy,
    textAlign: "center",
  },
  successSub: {
    color: COLORS.textSecondary,
    fontSize: TYPE.body,
    lineHeight: 21,
    textAlign: "center",
    maxWidth: 300,
  },
  successActions: {
    width: "100%",
    maxWidth: 340,
    gap: SPACING.md,
    marginTop: SPACING.md,
  },
});
