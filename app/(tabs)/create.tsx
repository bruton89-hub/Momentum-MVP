import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  Image,
  Pressable,
  Dimensions,
  Platform,
  Linking,
  KeyboardAvoidingView,
  Keyboard,
  AppState,
} from "react-native";
import { showAlert, showAlertWithAction, confirm } from "@/utils/alert";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { ResizeMode, Video } from "expo-av";
import { useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import Animated, { FadeIn, ZoomIn, useReducedMotion } from "react-native-reanimated";
import { useAuthStore } from "@/store/authStore";
import {
  uploadMedia,
  createPost,
  MAX_POST_MEDIA_BYTES,
} from "@/hooks/usePosts";
import type { CreatePostInput } from "@/hooks/usePosts";
import { createBattle } from "@/hooks/useBattles";
import type { CreateBattleInput } from "@/hooks/useBattles";
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
import type { CreationMutation } from "@/utils/creationMutation";
import { createCreationMutation } from "@/utils/creationMutation";
import { shouldPlayCreatePreview } from "@/utils/remediationGuards";

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

function pickerAssetType(asset: ImagePicker.ImagePickerAsset): "image" | "video" {
  if (asset.type === "video" || asset.mimeType?.toLowerCase().startsWith("video/")) {
    return "video";
  }
  // Expo ImagePicker 14's web implementation omits both `type` and `mimeType`
  // when its Image probe rejects a selected video. The FileReader data URI
  // still carries the authoritative MIME type.
  if (asset.uri.slice(0, 32).toLowerCase().startsWith("data:video/")) {
    return "video";
  }
  const extension = asset.fileName?.split(".").pop()?.toLowerCase();
  if (extension && ["mp4", "mov", "m4v", "webm", "avi"].includes(extension)) {
    return "video";
  }
  return "image";
}

export default function CreateScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const reducedMotion = useReducedMotion();
  const userId = useAuthStore((s) => s.userId);
  const profile = useAuthStore((s) => s.profile);

  const [mediaUri, setMediaUri] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<"image" | "video">("image");
  const [selectedMedia, setSelectedMedia] = useState<
    ImagePicker.ImagePickerAsset[]
  >([]);
  const [caption, setCaption] = useState("");
  const [step, setStep] = useState<1 | 2>(1);
  const [sportPickerOpen, setSportPickerOpen] = useState(false);
  const [optionalDetailsOpen, setOptionalDetailsOpen] = useState(false);
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
  const [appIsActive, setAppIsActive] = useState(AppState.currentState === "active");

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      const active = state === "active";
      setAppIsActive(active);
      if (!active) setPreviewPlaying(false);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!isFocused) setPreviewPlaying(false);
  }, [isFocused]);

  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [publishedWithChallenge, setPublishedWithChallenge] = useState(false);
  const publishingRef = useRef(false);

  // ── Resume state for a retried publish ─────────────────────────────────────
  // A publish is three network steps (upload → post doc → optional challenge).
  // If step 2 or 3 fails, the bytes for step 1 are already in Storage and the
  // post doc may already exist. Without this state, tapping Publish again
  // re-uploaded the same file (orphaning the first copy, which is billed
  // forever and never garbage-collected) and wrote a SECOND post document.
  // Keyed by source URI so choosing different media correctly starts over.
  const uploadedMediaRef = useRef<{ uri: string; url: string } | null>(null);
  const createdPostIdRef = useRef<string | null>(null);
  const postAttemptRef = useRef<{
    mutation: CreationMutation;
    input: CreatePostInput;
  } | null>(null);
  const battleAttemptRef = useRef<{
    mutation: CreationMutation;
    input: CreateBattleInput;
  } | null>(null);

  const clearPublishResumeState = useCallback(() => {
    uploadedMediaRef.current = null;
    createdPostIdRef.current = null;
    postAttemptRef.current = null;
    battleAttemptRef.current = null;
  }, []);

  const busy = isUploading || isSubmitting;
  const hasUnsavedWork =
    !!mediaUri || !!caption.trim() || !!position.trim() || !!school.trim();
  const videoDuration = formatDuration(selectedMedia[0]?.duration);

  function showPermissionAlert() {
    // showAlertWithAction degrades to a plain message on web, where there is no
    // OS settings screen to deep-link into.
    showAlertWithAction(
      "Photo access needed",
      "Momentum needs access to your photo library so you can choose a highlight to upload. You can enable it in Settings.",
      "Open Settings",
      () => {
        Linking.openSettings().catch(() => undefined);
      }
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
          showAlert(
            "Media too large",
            "Choose a photo or video that is 50 MB or smaller."
          );
          return;
        }
        clearPublishResumeState();
        setSelectedMedia([asset]);
        setMediaUri(asset.uri);
        setMediaType(pickerAssetType(asset));
        setPreviewPlaying(false);
        setPreviewMuted(true);
        setStep(1);
      }
    } catch (err) {
      console.error("Create media picker failed", err);
      showAlert("Media picker failed", "Could not select that media. Please try again.");
    }
  }

  const removeMedia = useCallback(() => {
    clearPublishResumeState();
    setSelectedMedia([]);
    setMediaUri(null);
    setMediaType("image");
    setPreviewPlaying(false);
  }, [clearPublishResumeState]);

  function resetForm() {
    removeMedia();
    setCaption("");
    setBattleEnabled(false);
    setCategoryPickerOpen(false);
    setPosition("");
    setSchool("");
    setUploadProgress(0);
    setStep(1);
    setSportPickerOpen(false);
    setOptionalDetailsOpen(false);
  }

  // ── Exit confirmation — never silently discard selected media or text. ─────
  async function handleClose() {
    if (busy) return; // publish in flight — don't abandon it
    if (!hasUnsavedWork) {
      router.replace("/");
      return;
    }
    // One code path for both platforms — confirm() handles the web/native split.
    const discard = await confirm({
      title: "Discard highlight?",
      message: "Your selected media and details will be lost.",
      confirmLabel: "Discard",
      cancelLabel: "Keep editing",
      destructive: true,
    });
    if (discard) {
      // Expo tabs stay mounted. A confirmed discard must clear both visible
      // draft state and the retained mutation/upload identities before leaving,
      // otherwise the next draft can inherit the abandoned logical operation.
      resetForm();
      router.replace("/");
    }
  }

  function handleContinue() {
    if (!mediaUri || busy) return;
    setPreviewPlaying(false);
    setStep(2);
  }

  async function handlePost() {
    if (busy || publishingRef.current) return;
    if (!userId || !profile) {
      showAlert("Sign in required", "Please sign in to post.");
      return;
    }
    if (!mediaUri) {
      showAlert("Add media", "Select a photo or video to post.");
      return;
    }

    Keyboard.dismiss();
    publishingRef.current = true;
    setIsUploading(true);
    setUploadProgress(0);

    try {
      // ── 1 · Media upload. Skipped when a previous attempt already put this
      //        exact file in Storage, so a retry costs no bandwidth and leaves
      //        no orphaned copy behind.
      let mediaUrl: string;
      if (uploadedMediaRef.current?.uri === mediaUri) {
        mediaUrl = uploadedMediaRef.current.url;
        setUploadProgress(100);
      } else {
        // Pass the complete picker asset on web so the uploader retains the
        // browser-provided MIME type and original filename while decoding its
        // data URI. Native still uses the same local URI path.
        mediaUrl = await uploadMedia(
          selectedMedia[0] ?? mediaUri,
          userId,
          setUploadProgress
        );
        uploadedMediaRef.current = { uri: mediaUri, url: mediaUrl };
      }

      setIsUploading(false);
      setIsSubmitting(true);

      // ── 3 · Post document. Reuse the id when a previous attempt already
      //        created it and only the challenge step failed — otherwise a
      //        retry publishes the same highlight twice.
      let postId = createdPostIdRef.current;
      if (!postId) {
        try {
          postAttemptRef.current ??= {
            mutation: createCreationMutation("post"),
            input: {
              userId,
              username: profile.username,
              userAvatar: profile.avatarUrl || profile.avatar,
              avatarUrl: profile.avatarUrl || profile.avatar,
              mediaUrl,
              mediaType,
              caption: caption.trim(),
              battleEnabled,
              sport: sport ?? undefined,
              position,
              school,
            },
          };
          postId = await createPost(
            postAttemptRef.current.input,
            postAttemptRef.current.mutation
          );
        } catch (error) {
          const detail = error instanceof Error ? error.message : "Unknown Firestore error.";
          throw new Error(`Media uploaded, but the post could not be created. ${detail}`);
        }
      }
      createdPostIdRef.current = postId;

      // ── 4 · Optional challenge. Separate document, separate failure mode.
      if (battleEnabled) {
        try {
          battleAttemptRef.current ??= {
            mutation: createCreationMutation("battle"),
            input: {
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
            },
          };
          await createBattle(
            battleAttemptRef.current.input,
            battleAttemptRef.current.mutation
          );
        } catch (battleError) {
          // The highlight IS live. Saying "couldn't publish" here was a lie
          // that pushed athletes into re-publishing a post that already
          // existed. Report the partial outcome and retry only what failed.
          console.error("[create] challenge creation failed after publish", battleError);
          showAlert(
            "Published — challenge didn't open",
            "Your highlight is live on the feed, but the challenge couldn't be created.\n\nTap Publish to retry just the challenge, or switch off \"Open for Challenge\" to finish up."
          );
          return;
        }
      }

      // Success — confirm before navigating anywhere.
      setPublishedWithChallenge(battleEnabled);
      resetForm();
      setShowSuccess(true);
    } catch (err) {
      // Recoverable failure — media, caption, and details all stay in state,
      // and the resume refs mean a retry picks up where this attempt stopped.
      console.error("Create post failed", err);
      const message =
        err instanceof Error ? err.message : "Something went wrong. Please try again.";
      showAlert(
        "Couldn't publish",
        `${message}\n\nYour highlight and details are still here — tap Publish to pick up where it stopped.`
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

      {/* Header and two-step progress stay visible while the content changes. */}
      <View style={styles.topBar}>
        <View style={styles.topBarClose}>
          <IconButton
            icon={step === 1 ? "x" : "arrow-left"}
            variant="plain"
            accessibilityLabel={step === 1 ? "Close create highlight" : "Back to media"}
            onPress={step === 1 ? handleClose : () => setStep(1)}
            disabled={busy}
          />
        </View>
        <Text style={styles.topBarTitle} accessibilityRole="header">New Highlight</Text>
        <View style={styles.topBarClose} />
      </View>

      <View style={styles.stepper} accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: 2, now: step }}>
        <View style={styles.stepItem}>
          <View style={[styles.stepDot, styles.stepDotActive]}><Text style={styles.stepNumberActive}>1</Text></View>
          <Text style={[styles.stepLabel, styles.stepLabelActive]}>Media</Text>
        </View>
        <View style={[styles.stepLine, step === 2 && styles.stepLineActive]} />
        <View style={styles.stepItem}>
          <View style={[styles.stepDot, step === 2 && styles.stepDotActive]}><Text style={step === 2 ? styles.stepNumberActive : styles.stepNumber}>2</Text></View>
          <Text style={[styles.stepLabel, step === 2 && styles.stepLabelActive]}>Details</Text>
        </View>
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
          {step === 1 ? <>
          {/* Step 1: media is the hero. */}
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
                    shouldPlay={shouldPlayCreatePreview(previewPlaying, isFocused, appIsActive)}
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

              {/* Replacement keeps the picker and all validation on one path. */}
              <View style={styles.mediaActions}>
                <Pressable
                  onPress={pickMedia}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={mediaType === "video" ? "Replace selected video" : "Replace selected photo"}
                  style={({ pressed }) => [styles.mediaActionBtn, pressed && { opacity: 0.75 }]}
                >
                  <Feather name="refresh-cw" size={13} color={COLORS.textPrimary} />
                  <Text style={styles.mediaActionText}>Replace Media</Text>
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

          {mediaUri && (
            <View style={styles.continueWrap}>
              <GlowButton label="Continue" onPress={handleContinue} disabled={busy} size="lg" accessibilityLabel="Continue to highlight details" />
            </View>
          )}
          </> : <>

          {/* Step 2: compact context preview, then the publishing essentials. */}
          {mediaUri && (
            <View style={styles.compactPreviewCard}>
              {mediaType === "image" ? (
                <Image source={{ uri: mediaUri }} style={styles.compactPreview} resizeMode="cover" />
              ) : (
                <Pressable onPress={() => setPreviewPlaying((value) => !value)} accessibilityRole="button" accessibilityLabel={previewPlaying ? "Pause video preview" : "Play video preview"} style={styles.compactPreview}>
                  <Video source={{ uri: mediaUri }} style={styles.mediaFill} resizeMode={ResizeMode.COVER} shouldPlay={shouldPlayCreatePreview(previewPlaying, isFocused, appIsActive)} isLooping isMuted={previewMuted} useNativeControls={false} />
                  <View style={styles.compactPlay}><Feather name={previewPlaying ? "pause" : "play"} size={18} color={COLORS.accent} /></View>
                </Pressable>
              )}
              <View style={styles.compactPreviewCopy}>
                <Text style={styles.compactEyebrow}>SELECTED MEDIA</Text>
                <Text style={styles.compactTitle}>{mediaType === "video" ? "Video highlight" : "Photo highlight"}</Text>
                <Pressable onPress={() => setStep(1)} disabled={busy} accessibilityRole="button" accessibilityLabel="Back to replace media" hitSlop={HIT_SLOP}>
                  <Text style={styles.compactEdit}>Edit media</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* Publishing essentials. */}
          <View style={styles.sectionCard}>
            <Text style={styles.fieldLabel} nativeID="create-sport-label">Sport</Text>
            <Pressable onPress={() => setSportPickerOpen((value) => !value)} disabled={busy} accessibilityRole="button" accessibilityLabel={`Sport: ${sport ?? "not selected"}`} accessibilityState={{ expanded: sportPickerOpen, disabled: busy }} style={({ pressed }) => [styles.selector, pressed && { opacity: 0.82 }]}>
              <Text style={[styles.selectorValue, !sport && styles.selectorPlaceholder]}>{sport ?? "Select a sport"}</Text>
              <Feather name={sportPickerOpen ? "chevron-up" : "chevron-down"} size={20} color={COLORS.textSecondary} />
            </Pressable>
            {sportPickerOpen && <View style={styles.sportGrid}>{ATHLETE_TYPES.map((value) => <Chip key={value} label={value} selected={sport === value} onPress={() => { setSport(value); setSportPickerOpen(false); }} disabled={busy} />)}</View>}

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

          <View style={styles.sectionCard}>
            <Pressable onPress={() => setOptionalDetailsOpen((value) => !value)} disabled={busy} accessibilityRole="button" accessibilityLabel="Optional details" accessibilityState={{ expanded: optionalDetailsOpen, disabled: busy }} style={styles.optionalHeader}>
              <View><Text style={styles.sectionTitle}>Optional details</Text><Text style={styles.optionalSub}>Add position and school or team</Text></View>
              <Feather name={optionalDetailsOpen ? "chevron-up" : "chevron-down"} size={20} color={COLORS.textMuted} />
            </Pressable>
            {optionalDetailsOpen && <View>
              <Text style={styles.fieldLabel} nativeID="create-position-label">Position</Text>
              <TextInput style={styles.fieldInput} placeholder="e.g. QB, Point Guard" placeholderTextColor={COLORS.textMuted} value={position} onChangeText={setPosition} editable={!busy} maxLength={40} accessibilityLabel="Position, optional" accessibilityLabelledBy="create-position-label" />
              <Text style={styles.fieldLabel} nativeID="create-school-label">School or team</Text>
              <TextInput style={styles.fieldInput} placeholder="e.g. Lincoln High" placeholderTextColor={COLORS.textMuted} value={school} onChangeText={setSchool} editable={!busy} maxLength={60} accessibilityLabel="School or team, optional" accessibilityLabelledBy="create-school-label" />
            </View>}
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
          </>}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Publish footer ──────────────────────────────────────────────────── */}
      {step === 2 && <View style={styles.footer}>
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
          label={publishLabel.toUpperCase()}
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
      </View>}
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
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.background,
  },
  stepItem: { flexDirection: "row", alignItems: "center", gap: 7 },
  stepDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    backgroundColor: COLORS.surface,
  },
  stepDotActive: { borderColor: COLORS.accent, backgroundColor: COLORS.accent },
  stepNumber: { color: COLORS.textMuted, fontSize: TYPE.caption, fontWeight: FONTS.bold },
  stepNumberActive: { color: COLORS.black, fontSize: TYPE.caption, fontWeight: FONTS.heavy },
  stepLabel: { color: COLORS.textMuted, fontSize: TYPE.footnote, fontWeight: FONTS.semibold },
  stepLabelActive: { color: COLORS.textPrimary },
  stepLine: { width: 54, height: 1, marginHorizontal: SPACING.md, backgroundColor: COLORS.inputBorder },
  stepLineActive: { backgroundColor: COLORS.accent },

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
  continueWrap: { marginHorizontal: SPACING.lg, marginTop: SPACING.xs },

  // ── Details media context ─────────────────────────────────────────────────
  compactPreviewCard: {
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
    padding: SPACING.sm,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.surface,
  },
  compactPreview: {
    width: 92,
    height: 108,
    borderRadius: RADIUS.md,
    overflow: "hidden",
    backgroundColor: COLORS.surfaceDeep,
  },
  compactPlay: {
    position: "absolute",
    alignSelf: "center",
    top: 38,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.scrimBadge,
  },
  compactPreviewCopy: { flex: 1, alignItems: "flex-start", gap: 4 },
  compactEyebrow: { color: COLORS.textMuted, fontSize: TYPE.micro, fontWeight: FONTS.bold, letterSpacing: 0.8 },
  compactTitle: { color: COLORS.textPrimary, fontSize: TYPE.callout, fontWeight: FONTS.heavy },
  compactEdit: { color: COLORS.accent, fontSize: TYPE.footnote, fontWeight: FONTS.bold, marginTop: 5 },

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
  selector: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    backgroundColor: COLORS.input,
  },
  selectorValue: { color: COLORS.textPrimary, fontSize: TYPE.base, fontWeight: FONTS.semibold },
  selectorPlaceholder: { color: COLORS.textMuted, fontWeight: FONTS.regular },
  sportGrid: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.sm, paddingTop: SPACING.md },
  optionalHeader: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  optionalSub: { color: COLORS.textMuted, fontSize: TYPE.small, marginTop: 3 },

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
