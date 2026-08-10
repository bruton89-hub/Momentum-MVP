import { Alert, Platform } from "react-native";

/**
 * Cross-platform alerts and confirmations.
 *
 * WHY THIS EXISTS
 * ───────────────
 * react-native-web ships `Alert` as a stub with an EMPTY implementation:
 *
 *     class Alert { static alert() {} }
 *
 * Not a partial polyfill — a no-op. Every `Alert.alert(...)` in this app
 * silently did nothing on web. Failures that were carefully caught and
 * reported ("Couldn't publish", "Couldn't delete post", "Save failed")
 * produced no dialog at all, so the app looked frozen or looked like it had
 * silently succeeded. Delete was the visible symptom: the confirm sheet stayed
 * open with no message because the error path only ever called `Alert.alert`.
 *
 * A pre-existing comment in the codebase said web "only polyfills a basic
 * window.alert that ignores the buttons array". That was optimistic — the
 * buttons array is ignored because the whole function is.
 *
 * Use these helpers instead of importing `Alert` directly.
 */

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** Label for the affirmative action. */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm action in red on native. */
  destructive?: boolean;
}

const isWeb = Platform.OS === "web";

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

/**
 * Informational message with a single dismiss action.
 *
 * Native: standard Alert. Web: window.alert, which blocks the thread — that's
 * acceptable for the terminal error/success cases this is used for, and is
 * vastly preferable to showing nothing.
 */
export function showAlert(title: string, message?: string): void {
  if (isWeb) {
    if (hasWindow() && typeof window.alert === "function") {
      window.alert(message ? `${title}\n\n${message}` : title);
    } else {
      // No window (SSR/prerender). Never swallow it silently.
      console.warn(`[alert] ${title}${message ? ` — ${message}` : ""}`);
    }
    return;
  }
  Alert.alert(title, message);
}

/**
 * Two-choice confirmation. Resolves true when the user confirms.
 *
 * Always await this rather than passing an onPress callback: RN's Alert is
 * callback-based and web's confirm is synchronous, and a promise is the only
 * shape that reads the same on both.
 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  const {
    title,
    message,
    confirmLabel = "OK",
    cancelLabel = "Cancel",
    destructive = false,
  } = options;

  if (isWeb) {
    if (hasWindow() && typeof window.confirm === "function") {
      return Promise.resolve(
        window.confirm(message ? `${title}\n\n${message}` : title)
      );
    }
    // No window.confirm available. Refuse rather than assume yes — this gates
    // destructive actions like post deletion and sign-out.
    console.warn(`[confirm] unavailable, treated as cancelled: ${title}`);
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancelLabel, style: "cancel", onPress: () => resolve(false) },
      {
        text: confirmLabel,
        style: destructive ? "destructive" : "default",
        onPress: () => resolve(true),
      },
    ]);
  });
}

/**
 * Copy text to the clipboard, returning whether it worked.
 *
 * Used as the fallback when the native share sheet is unavailable — notably on
 * web, where RN's Share rejects in any browser without navigator.share.
 * Resolves false rather than throwing so callers can report honestly.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === "function"
    ) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Denied permission, or a non-secure context.
  }
  return false;
}

/**
 * Alert with an optional secondary action (e.g. "Open Settings").
 * Falls back to a plain message on web, where no such affordance exists.
 */
export function showAlertWithAction(
  title: string,
  message: string,
  actionLabel: string,
  onAction: () => void
): void {
  if (isWeb) {
    showAlert(title, message);
    return;
  }
  Alert.alert(title, message, [
    { text: "Not now", style: "cancel" },
    { text: actionLabel, onPress: onAction },
  ]);
}
