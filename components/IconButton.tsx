import React from "react";
import { Pressable, StyleSheet, ViewStyle, StyleProp } from "react-native";
import { Feather } from "@expo/vector-icons";
import { COLORS, HIT_SLOP } from "@/constants/theme";

interface Props {
  /** Feather icon name, e.g. "bell", "settings", "chevron-left", "x", "share". */
  icon: React.ComponentProps<typeof Feather>["name"];
  /** Required for screen readers — describes the action, not the icon. */
  accessibilityLabel: string;
  onPress?: () => void;
  /** Outer diameter. Icon scales to ~55%. */
  size?: number;
  color?: string;
  disabled?: boolean;
  /** "surface" = charcoal circle w/ border (default). "plain" = no chrome. */
  variant?: "surface" | "plain";
  style?: StyleProp<ViewStyle>;
}

/**
 * Circular icon button — the single tap-target used for headers, sheets, and
 * cards (bell, settings, back, close, share). Replaces the six hand-rolled
 * 26–36px circle buttons that previously used emoji/text glyphs.
 */
export default function IconButton({
  icon,
  accessibilityLabel,
  onPress,
  size = 36,
  color = COLORS.textSecondary,
  disabled = false,
  variant = "surface",
  style,
}: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.base,
        variant === "surface" && styles.surface,
        { width: size, height: size, borderRadius: size / 2 },
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Feather name={icon} size={Math.round(size * 0.55)} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
  },
  surface: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
});
