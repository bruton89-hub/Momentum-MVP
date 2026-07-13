import React from "react";
import {
  Pressable,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
} from "react-native";
import { COLORS, RADIUS, SPACING, FONTS, GLOW, TYPE } from "@/constants/theme";

interface Props {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  /** Neon glow shadow — on by default for primary; set false to disable. */
  glow?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  accessibilityLabel?: string;
}

export default function GlowButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  variant = "primary",
  size = "md",
  glow,
  style,
  textStyle,
  accessibilityLabel,
}: Props) {
  const isDisabled = disabled || loading;
  const showGlow = (glow ?? variant === "primary") && !isDisabled;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        styles[`size_${size}`],
        showGlow && GLOW.accent,
        pressed && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === "primary" ? COLORS.black : COLORS.accent}
        />
      ) : (
        <Text
          style={[
            styles.text,
            styles[`text_${variant}`],
            styles[`textSize_${size}`],
            textStyle,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: RADIUS.md,
  },
  pressed: { opacity: 0.82, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.45 },

  // Variants
  primary: {
    backgroundColor: COLORS.accent,
  },
  secondary: {
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: COLORS.accent,
  },
  ghost: {
    backgroundColor: COLORS.accentFaint,
  },
  danger: {
    backgroundColor: COLORS.error,
  },

  // Sizes
  size_sm: { paddingVertical: 8, paddingHorizontal: SPACING.md },
  size_md: { paddingVertical: 12, paddingHorizontal: SPACING.lg },
  size_lg: { paddingVertical: 16, paddingHorizontal: SPACING.xl },

  // Text base
  text: { fontWeight: FONTS.heavy },
  text_primary: { color: COLORS.black },
  text_secondary: { color: COLORS.accent },
  text_ghost: { color: COLORS.accent },
  text_danger: { color: COLORS.white },

  textSize_sm: { fontSize: TYPE.footnote },
  textSize_md: { fontSize: TYPE.base },
  textSize_lg: { fontSize: TYPE.callout + 1 },
});
