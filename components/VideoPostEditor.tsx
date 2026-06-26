import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import {
  Audio,
  type AVPlaybackStatus,
  ResizeMode,
  Video,
} from "expo-av";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  VIDEO_AUDIO_TRACKS,
  type VideoAudioTrackId,
  type VideoEditSettings,
} from "@/constants/videoEditing";
import { COLORS, FONTS, RADIUS, SPACING } from "@/constants/theme";

interface Props {
  uri: string;
  selectedMusic: VideoAudioTrackId | null;
  onSelectedMusicChange: (music: VideoAudioTrackId | null) => void;
  trimStart: number;
  onTrimStartChange: (seconds: number) => void;
  trimEnd: number | null;
  onTrimEndChange: (seconds: number | null) => void;
  textOverlay: string;
  onTextOverlayChange: (text: string) => void;
  selectedCoverUri: string | null;
  onSelectedCoverUriChange: (uri: string | null) => void;
  showPreview?: boolean;
  disabled?: boolean;
}

type EditorModal = "editor" | "music" | "trim" | "cover" | null;

const TRIM_STEP_SECONDS = 0.5;
const MIN_CLIP_SECONDS = 1;
const PLACEHOLDER_DURATION_SECONDS = 15;

export default function VideoPostEditor({
  uri,
  selectedMusic,
  onSelectedMusicChange,
  trimStart,
  onTrimStartChange,
  trimEnd: selectedTrimEnd,
  onTrimEndChange,
  textOverlay,
  onTextOverlayChange,
  selectedCoverUri,
  onSelectedCoverUriChange,
  showPreview = true,
  disabled = false,
}: Props) {
  const videoRef = useRef<Video>(null);
  const musicRef = useRef<Audio.Sound | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [activeModal, setActiveModal] = useState<EditorModal>(null);

  const value: VideoEditSettings = {
    trimStartSeconds: trimStart,
    trimEndSeconds: selectedTrimEnd,
    audioTrackId: selectedMusic,
    textOverlay,
  };
  const effectiveDuration = durationSeconds || PLACEHOLDER_DURATION_SECONDS;
  const trimEnd = selectedTrimEnd ?? effectiveDuration;
  const coverSelected = selectedCoverUri !== null;
  const selectedTrack = VIDEO_AUDIO_TRACKS.find(
    (track) => track.id === selectedMusic
  );

  function onChange(settings: VideoEditSettings) {
    onSelectedMusicChange(settings.audioTrackId);
    onTrimStartChange(settings.trimStartSeconds);
    onTrimEndChange(settings.trimEndSeconds);
    onTextOverlayChange(settings.textOverlay);
  }

  const stopPreview = useCallback(async () => {
    setIsPreviewing(false);
    await Promise.all([
      videoRef.current?.pauseAsync().catch(() => undefined),
      musicRef.current?.pauseAsync().catch(() => undefined),
    ]);
  }, []);

  useEffect(() => {
    return () => {
      musicRef.current?.unloadAsync().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    setActiveModal(null);
  }, [uri]);

  useEffect(() => {
    let cancelled = false;

    async function loadMusic() {
      await musicRef.current?.unloadAsync().catch(() => undefined);
      musicRef.current = null;

      const track = VIDEO_AUDIO_TRACKS.find(
        (candidate) => candidate.id === value.audioTrackId
      );
      if (!track) return;

      const { sound } = await Audio.Sound.createAsync(track.asset, {
        isLooping: true,
        volume: 0.45,
        shouldPlay: false,
      });
      if (cancelled) {
        await sound.unloadAsync().catch(() => undefined);
        return;
      }
      musicRef.current = sound;
    }

    stopPreview().then(loadMusic).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [stopPreview, value.audioTrackId]);

  const startPreview = useCallback(async () => {
    if (!videoRef.current) return;
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
    }).catch(() => undefined);
    await videoRef.current.setPositionAsync(value.trimStartSeconds * 1000);
    await musicRef.current?.setPositionAsync(0).catch(() => undefined);
    setIsPreviewing(true);
    await Promise.all([
      videoRef.current.playAsync(),
      musicRef.current?.playAsync().catch(() => undefined),
    ]);
  }, [value.trimStartSeconds]);

  const handleStatus = useCallback(
    (status: AVPlaybackStatus) => {
      if (!status.isLoaded) return;
      if (status.durationMillis) {
        const nextDuration = status.durationMillis / 1000;
        setDurationSeconds((current) =>
          Math.abs(current - nextDuration) > 0.05 ? nextDuration : current
        );
      }
      if (
        isPreviewing &&
        status.positionMillis >= Math.max(value.trimStartSeconds, trimEnd) * 1000
      ) {
        stopPreview()
          .then(() =>
            videoRef.current?.setPositionAsync(value.trimStartSeconds * 1000)
          )
          .catch(() => undefined);
      }
    },
    [isPreviewing, stopPreview, trimEnd, value.trimStartSeconds]
  );

  function openModal(modal: Exclude<EditorModal, null>) {
    stopPreview().catch(() => undefined);
    setActiveModal(modal);
  }

  function updateTrimStart(delta: number) {
    const maxStart = Math.max(0, trimEnd - MIN_CLIP_SECONDS);
    onChange({
      ...value,
      trimStartSeconds: Math.min(
        maxStart,
        Math.max(0, value.trimStartSeconds + delta)
      ),
    });
  }

  function updateTrimEnd(delta: number) {
    onChange({
      ...value,
      trimEndSeconds: Math.min(
        effectiveDuration,
        Math.max(value.trimStartSeconds + MIN_CLIP_SECONDS, trimEnd + delta)
      ),
    });
  }

  return (
    <View style={styles.container}>
      {showPreview && (
        <View style={styles.preview}>
          <Video
            ref={videoRef}
            source={{ uri }}
            style={StyleSheet.absoluteFillObject}
            resizeMode={ResizeMode.COVER}
            shouldPlay={false}
            isLooping={false}
            isMuted={false}
            useNativeControls={false}
            onPlaybackStatusUpdate={handleStatus}
          />
          {!!value.textOverlay.trim() && (
            <View pointerEvents="none" style={styles.textOverlayWrap}>
              <Text style={styles.textOverlay}>{value.textOverlay.trim()}</Text>
            </View>
          )}
          <Pressable
            onPress={isPreviewing ? stopPreview : startPreview}
            disabled={disabled}
            style={styles.previewButton}
          >
            <Feather
              name={isPreviewing ? "pause" : "play"}
              size={16}
              color={COLORS.accent}
            />
            <Text style={styles.previewButtonText}>
              {isPreviewing ? "Pause" : "Preview"}
            </Text>
          </Pressable>
          {coverSelected && (
            <View style={styles.coverBadge}>
              <Feather name="check" size={12} color={COLORS.black} />
              <Text style={styles.coverBadgeText}>Cover selected</Text>
            </View>
          )}
        </View>
      )}

      <View style={styles.actionRow}>
        <EditorAction
          icon="tune-variant"
          label="Edit Video"
          onPress={() => openModal("editor")}
          disabled={disabled}
        />
        <EditorAction
          icon="music-note"
          label="Add Music"
          detail={selectedTrack?.label}
          active={value.audioTrackId !== null}
          onPress={() => openModal("music")}
          disabled={disabled}
        />
        <EditorAction
          icon="content-cut"
          label="Trim"
          active={value.trimStartSeconds > 0 || value.trimEndSeconds !== null}
          onPress={() => openModal("trim")}
          disabled={disabled}
        />
        <EditorAction
          icon="image-outline"
          label="Cover"
          active={coverSelected}
          onPress={() => openModal("cover")}
          disabled={disabled}
        />
      </View>

      <EditorSheet
        visible={activeModal === "editor"}
        title="Video Editor"
        subtitle="Add a text overlay to your highlight."
        onClose={() => setActiveModal(null)}
      >
        <Text style={styles.fieldLabel}>Text overlay</Text>
        <TextInput
          value={value.textOverlay}
          onChangeText={(textOverlay) => onChange({ ...value, textOverlay })}
          maxLength={60}
          placeholder="Add text on the video"
          placeholderTextColor={COLORS.textMuted}
          style={styles.textInput}
        />
        <Text style={styles.helperText}>
          More video effects are coming soon.
        </Text>
      </EditorSheet>

      <EditorSheet
        visible={activeModal === "music"}
        title="Add Music"
        subtitle="Choose a royalty-free sample track."
        onClose={() => setActiveModal(null)}
      >
        <TrackOption
          label="Original audio"
          selected={value.audioTrackId === null}
          onPress={() => onChange({ ...value, audioTrackId: null })}
        />
        {VIDEO_AUDIO_TRACKS.map((track) => (
          <TrackOption
            key={track.id}
            label={track.label}
            selected={value.audioTrackId === track.id}
            onPress={() => onChange({ ...value, audioTrackId: track.id })}
          />
        ))}
      </EditorSheet>

      <EditorSheet
        visible={activeModal === "trim"}
        title="Trim Video"
        subtitle="Set simple start and end points for your clip."
        onClose={() => setActiveModal(null)}
      >
        <View style={styles.trimTimeline}>
          <View style={styles.trimSelection} />
        </View>
        <View style={styles.trimRow}>
          <TrimControl
            label="Start"
            value={value.trimStartSeconds}
            onDecrease={() => updateTrimStart(-TRIM_STEP_SECONDS)}
            onIncrease={() => updateTrimStart(TRIM_STEP_SECONDS)}
            disabled={disabled}
          />
          <TrimControl
            label="End"
            value={trimEnd}
            onDecrease={() => updateTrimEnd(-TRIM_STEP_SECONDS)}
            onIncrease={() => updateTrimEnd(TRIM_STEP_SECONDS)}
            disabled={disabled}
          />
        </View>
      </EditorSheet>

      <EditorSheet
        visible={activeModal === "cover"}
        title="Choose Cover"
        subtitle="Use the current video frame as your thumbnail."
        onClose={() => setActiveModal(null)}
      >
        <View style={styles.coverPreview}>
          <Video
            source={{ uri }}
            style={StyleSheet.absoluteFillObject}
            resizeMode={ResizeMode.COVER}
            shouldPlay={false}
            isMuted
            useNativeControls={false}
          />
          <View style={styles.coverFrame}>
            <Feather name="image" size={24} color={COLORS.accent} />
            <Text style={styles.coverFrameText}>Current thumbnail</Text>
          </View>
        </View>
        <Pressable
          onPress={() => {
            onSelectedCoverUriChange(uri);
            setActiveModal(null);
          }}
          style={styles.primaryButton}
        >
          <Feather name="check" size={18} color={COLORS.black} />
          <Text style={styles.primaryButtonText}>
            {coverSelected ? "Use Current Thumbnail" : "Select This Cover"}
          </Text>
        </Pressable>
      </EditorSheet>
    </View>
  );
}

function EditorAction({
  icon,
  label,
  detail,
  active = false,
  onPress,
  disabled,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  label: string;
  detail?: string;
  active?: boolean;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.action,
        active && styles.actionActive,
        pressed && styles.actionPressed,
      ]}
    >
      <View style={[styles.actionIcon, active && styles.actionIconActive]}>
        <MaterialCommunityIcons
          name={icon}
          size={21}
          color={active ? COLORS.black : COLORS.accent}
        />
      </View>
      <Text style={styles.actionLabel} numberOfLines={1}>
        {label}
      </Text>
      {!!detail && (
        <Text style={styles.actionDetail} numberOfLines={1}>
          {detail}
        </Text>
      )}
    </Pressable>
  );
}

function EditorSheet({
  visible,
  title,
  subtitle,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.modalSafe}>
        <View style={styles.modalHeader}>
          <View>
            <Text style={styles.modalTitle}>{title}</Text>
            <Text style={styles.modalSubtitle}>{subtitle}</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12} style={styles.closeButton}>
            <Feather name="x" size={22} color={COLORS.textPrimary} />
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={styles.modalContent}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
        <View style={styles.modalFooter}>
          <Pressable onPress={onClose} style={styles.doneButton}>
            <Text style={styles.doneButtonText}>Done</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function TrackOption({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.trackOption, selected && styles.trackOptionSelected]}
    >
      <View style={[styles.trackIcon, selected && styles.trackIconSelected]}>
        <Feather
          name={label === "Original audio" ? "volume-2" : "music"}
          size={18}
          color={selected ? COLORS.black : COLORS.accent}
        />
      </View>
      <View style={styles.trackCopy}>
        <Text style={styles.trackLabel}>{label}</Text>
        <Text style={styles.trackMeta}>Royalty-free sample</Text>
      </View>
      {selected && (
        <Feather name="check-circle" size={22} color={COLORS.accent} />
      )}
    </Pressable>
  );
}

function TrimControl({
  label,
  value,
  onDecrease,
  onIncrease,
  disabled,
}: {
  label: string;
  value: number;
  onDecrease: () => void;
  onIncrease: () => void;
  disabled: boolean;
}) {
  return (
    <View style={styles.trimControl}>
      <Text style={styles.trimLabel}>{label}</Text>
      <View style={styles.stepper}>
        <Pressable
          disabled={disabled}
          onPress={onDecrease}
          style={styles.stepButton}
        >
          <Text style={styles.stepButtonText}>−</Text>
        </Pressable>
        <Text style={styles.trimValue}>{value.toFixed(1)}s</Text>
        <Pressable
          disabled={disabled}
          onPress={onIncrease}
          style={styles.stepButton}
        >
          <Text style={styles.stepButtonText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: SPACING.sm,
  },
  preview: {
    height: 300,
    marginHorizontal: SPACING.lg,
    overflow: "hidden",
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.black,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  previewButton: {
    position: "absolute",
    right: SPACING.md,
    bottom: SPACING.md,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.full,
    backgroundColor: "rgba(0,0,0,0.78)",
    borderWidth: 1,
    borderColor: COLORS.accent,
  },
  previewButtonText: {
    color: COLORS.accent,
    fontWeight: FONTS.bold,
  },
  coverBadge: {
    position: "absolute",
    left: SPACING.md,
    top: SPACING.md,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 5,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.accent,
  },
  coverBadgeText: {
    color: COLORS.black,
    fontSize: 11,
    fontWeight: FONTS.bold,
  },
  textOverlayWrap: {
    position: "absolute",
    left: SPACING.lg,
    right: SPACING.lg,
    bottom: 54,
    alignItems: "center",
  },
  textOverlay: {
    color: COLORS.white,
    fontSize: 24,
    lineHeight: 29,
    fontWeight: FONTS.heavy,
    textAlign: "center",
    textShadowColor: COLORS.black,
    textShadowOffset: { width: 1, height: 2 },
    textShadowRadius: 4,
  },
  actionRow: {
    flexDirection: "row",
    marginHorizontal: SPACING.lg,
    gap: SPACING.sm,
  },
  action: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  actionActive: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accentFaint,
  },
  actionPressed: {
    opacity: 0.72,
  },
  actionIcon: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 3,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.accentFaint,
  },
  actionIconActive: {
    backgroundColor: COLORS.accent,
  },
  actionLabel: {
    color: COLORS.textPrimary,
    fontSize: 10,
    fontWeight: FONTS.bold,
  },
  actionDetail: {
    color: COLORS.accent,
    fontSize: 9,
    marginTop: 2,
  },
  modalSafe: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
  },
  modalTitle: {
    color: COLORS.textPrimary,
    fontSize: 22,
    fontWeight: FONTS.heavy,
  },
  modalSubtitle: {
    color: COLORS.textSecondary,
    fontSize: 13,
    marginTop: SPACING.xs,
  },
  closeButton: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface,
  },
  modalContent: {
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  modalFooter: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.lg,
    borderTopWidth: 1,
    borderTopColor: COLORS.cardBorder,
  },
  doneButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 50,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.accent,
  },
  doneButtonText: {
    color: COLORS.black,
    fontSize: 16,
    fontWeight: FONTS.heavy,
  },
  fieldLabel: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: FONTS.bold,
  },
  textInput: {
    minHeight: 54,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    backgroundColor: COLORS.input,
    color: COLORS.textPrimary,
  },
  helperText: {
    color: COLORS.textMuted,
    fontSize: 12,
  },
  trackOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.surface,
  },
  trackOptionSelected: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accentFaint,
  },
  trackIcon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.accentFaint,
  },
  trackIconSelected: {
    backgroundColor: COLORS.accent,
  },
  trackCopy: {
    flex: 1,
  },
  trackLabel: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: FONTS.bold,
  },
  trackMeta: {
    color: COLORS.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  trimTimeline: {
    height: 64,
    justifyContent: "center",
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  trimSelection: {
    height: 42,
    borderRadius: RADIUS.sm,
    borderWidth: 2,
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accentFaint,
  },
  trimRow: {
    flexDirection: "row",
    gap: SPACING.md,
  },
  trimControl: {
    flex: 1,
    padding: SPACING.md,
    gap: SPACING.sm,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
  },
  trimLabel: {
    color: COLORS.textSecondary,
    fontSize: 12,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  stepButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.input,
  },
  stepButtonText: {
    color: COLORS.accent,
    fontSize: 20,
    lineHeight: 22,
  },
  trimValue: {
    color: COLORS.textPrimary,
    fontWeight: FONTS.bold,
  },
  coverPreview: {
    height: 360,
    overflow: "hidden",
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.accent,
  },
  coverFrame: {
    position: "absolute",
    left: SPACING.md,
    right: SPACING.md,
    bottom: SPACING.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.sm,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    backgroundColor: "rgba(0,0,0,0.78)",
  },
  coverFrameText: {
    color: COLORS.textPrimary,
    fontWeight: FONTS.bold,
  },
  primaryButton: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.sm,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.accent,
  },
  primaryButtonText: {
    color: COLORS.black,
    fontSize: 15,
    fontWeight: FONTS.heavy,
  },
});
