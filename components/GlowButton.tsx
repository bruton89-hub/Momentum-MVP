import React from "react";
import {
  Pressable,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
} from "react-native";
import { COLORS, RADIUS, SPACING, FONTS } from "@/constants/theme";

interface Props {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  style?: ViewStyle;
  textStyle?: TextStyle;
}

export default function GlowButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  variant = "primary",
  size = "md",
  style,
  textStyle,
}: Props) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        styles[`size_${size}`],
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
  pressed: { opacity: 0.82 },
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

  textSize_sm: { fontSize: 13 },
  textSize_md: { fontSize: 15 },
  textSize_lg: { fontSize: 17 },
});
