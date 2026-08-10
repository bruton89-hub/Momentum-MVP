import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SPACING, TYPE } from "@/constants/theme";
import {
  deletePost,
  postDeletionErrorMessage,
  type DeletePostResult,
} from "@/services/postDeletion";

interface Props {
  postId: string;
  visible: boolean;
  onClose: () => void;
  onDeleted?: (postId: string, result: DeletePostResult) => void;
  onError: (message: string) => void;
  onWarning: (message: string) => void;
}

export default function PostOwnerMenu({
  postId,
  visible,
  onClose,
  onDeleted,
  onError,
  onWarning,
}: Props) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Failure text rendered inside the sheet. Previously the only feedback was an
  // Alert from the parent — and react-native-web's Alert is a no-op, so on web
  // a failed delete produced absolutely nothing: the sheet just sat there with
  // the button re-enabled, looking like the tap hadn't registered.
  const [error, setError] = useState<string | null>(null);
  const deletingRef = useRef(false);

  function dismiss() {
    if (deletingRef.current) return;
    setConfirming(false);
    setError(null);
    onClose();
  }

  async function confirmDelete() {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    setError(null);
    try {
      const result = await deletePost(postId);
      setConfirming(false);
      onClose();
      onDeleted?.(postId, result);
      if (!result.mediaCleanupComplete) {
        onWarning(
          "The post was deleted, but its media could not be fully removed. The cleanup error was logged."
        );
      }
    } catch (err) {
      const message = postDeletionErrorMessage(err);
      // Shown in place AND handed to the parent. The sheet stays open so the
      // athlete can read it and retry without reopening the menu.
      setError(message);
      onError(message);
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={dismiss}
    >
      <View style={styles.overlay}>
        <Pressable
          style={StyleSheet.absoluteFillObject}
          onPress={dismiss}
          disabled={deleting}
          accessibilityLabel="Close post options"
        />
        <View style={styles.card} accessibilityViewIsModal>
          {confirming ? (
            <>
              <View style={styles.destructiveIcon}>
                <Feather name="trash-2" size={22} color={COLORS.error} />
              </View>
              <Text style={styles.title}>Delete post?</Text>
              <Text style={styles.message}>
                This will permanently remove the post and cannot be undone.
              </Text>
              {error && (
                <View style={styles.errorBox} accessibilityLiveRegion="polite">
                  <Feather name="alert-circle" size={14} color={COLORS.error} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}
              <View style={styles.actions}>
                <Pressable
                  style={({ pressed }) => [
                    styles.button,
                    styles.cancelButton,
                    pressed && !deleting && styles.pressed,
                  ]}
                  onPress={() => setConfirming(false)}
                  disabled={deleting}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel deleting post"
                >
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.button,
                    styles.deleteButton,
                    pressed && !deleting && styles.pressed,
                    deleting && styles.disabled,
                  ]}
                  onPress={() => void confirmDelete()}
                  disabled={deleting}
                  accessibilityRole="button"
                  accessibilityLabel="Permanently delete post"
                  accessibilityState={{ disabled: deleting, busy: deleting }}
                >
                  {deleting ? (
                    <ActivityIndicator size="small" color={COLORS.white} />
                  ) : (
                    <Feather name="trash-2" size={16} color={COLORS.white} />
                  )}
                  <Text style={styles.deleteText}>
                    {deleting ? "Deleting…" : "Delete"}
                  </Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.title}>Post options</Text>
              <Pressable
                style={({ pressed }) => [
                  styles.deleteRow,
                  pressed && styles.pressed,
                ]}
                onPress={() => setConfirming(true)}
                accessibilityRole="button"
                accessibilityLabel="Delete Post"
              >
                <Feather name="trash-2" size={20} color={COLORS.error} />
                <Text style={styles.deleteRowText}>Delete Post</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.cancelRow, pressed && styles.pressed]}
                onPress={dismiss}
                accessibilityRole="button"
                accessibilityLabel="Cancel post options"
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: SPACING.xl,
    backgroundColor: COLORS.overlay,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    padding: SPACING.xl,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.surfaceRaised,
    gap: SPACING.md,
  },
  destructiveIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.errorFaint,
  },
  title: {
    color: COLORS.textPrimary,
    fontSize: TYPE.title3,
    fontWeight: FONTS.heavy,
  },
  message: {
    color: COLORS.textSecondary,
    fontSize: TYPE.body,
    lineHeight: 20,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: SPACING.sm,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.error,
    backgroundColor: COLORS.errorFaint,
  },
  errorText: {
    flex: 1,
    color: COLORS.error,
    fontSize: TYPE.footnote,
    lineHeight: 18,
  },
  actions: { flexDirection: "row", gap: SPACING.sm, marginTop: SPACING.sm },
  button: {
    flex: 1,
    minHeight: 48,
    borderRadius: RADIUS.md,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: SPACING.sm,
  },
  cancelButton: { borderWidth: 1, borderColor: COLORS.cardBorder },
  deleteButton: { backgroundColor: COLORS.error },
  deleteText: { color: COLORS.white, fontWeight: FONTS.bold, fontSize: TYPE.base },
  cancelText: { color: COLORS.textPrimary, fontWeight: FONTS.bold, fontSize: TYPE.base },
  deleteRow: {
    minHeight: 52,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
    backgroundColor: COLORS.errorFaint,
  },
  deleteRowText: { color: COLORS.error, fontSize: TYPE.base, fontWeight: FONTS.bold },
  cancelRow: { minHeight: 48, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.65 },
});
