import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { COLORS, SPACING, FONTS } from "@/constants/theme";
import GlowButton from "./GlowButton";

interface Props {
  icon?: string;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * Encouraging empty state — icon in a Momentum-green ring, bold headline,
 * supportive copy, and a glowing CTA. Fades up on mount so empty screens
 * still feel alive.
 */
export default function EmptyState({
  icon = "🏟️",
  title,
  subtitle,
  actionLabel,
  onAction,
}: Props) {
  return (
    <Animated.View
      entering={FadeInDown.duration(320).springify()}
      style={styles.container}
      accessible
      accessibilityLabel={`${title}${subtitle ? `. ${subtitle}` : ""}`}
    >
      <View style={styles.iconRing}>
        <Text style={styles.icon} accessibilityElementsHidden importantForAccessibility="no">
          {icon}
        </Text>
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {actionLabel && onAction ? (
        <GlowButton
          label={actionLabel}
          onPress={onAction}
          style={styles.button}
        />
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: SPACING.xxl,
    paddingVertical: SPACING.xxxl,
  },
  iconRing: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 1.5,
    borderColor: COLORS.accentBorderFaint,
    backgroundColor: COLORS.accentFaint,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: SPACING.xl,
  },
  icon: { fontSize: 40 },
  title: {
    color: COLORS.textPrimary,
    fontSize: 21,
    fontWeight: FONTS.extrabold,
    textAlign: "center",
    letterSpacing: 0.2,
    marginBottom: SPACING.sm,
  },
  subtitle: {
    color: COLORS.textSecondary,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 21,
    marginBottom: SPACING.lg,
  },
  button: { marginTop: SPACING.md, minWidth: 170 },
});
