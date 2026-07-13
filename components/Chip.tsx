import React from "react";
import { Pressable, Text, StyleSheet } from "react-native";
import { COLORS, SPACING, RADIUS, FONTS, TYPE } from "@/constants/theme";

interface Props {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}

/**
 * Selectable pill chip — sport pickers, battle categories, durations.
 * Replaces three duplicated chip implementations (register, edit profile,
 * create screen) that had drifting padding and background colors.
 */
export default function Chip({ label, selected, onPress, disabled = false }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipActive,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.text, selected && styles.textActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm - 2,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    backgroundColor: COLORS.surface,
  },
  chipActive: {
    backgroundColor: COLORS.accentFaint,
    borderColor: COLORS.accent,
  },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },
  text: {
    color: COLORS.textSecondary,
    fontSize: TYPE.footnote,
    fontWeight: FONTS.medium,
  },
  textActive: {
    color: COLORS.accent,
    fontWeight: FONTS.bold,
  },
});
