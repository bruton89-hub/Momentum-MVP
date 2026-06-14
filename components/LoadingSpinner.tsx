import React from "react";
import { View, ActivityIndicator, Text, StyleSheet } from "react-native";
import { COLORS, SPACING } from "@/constants/theme";

interface Props {
  label?: string;
  fullscreen?: boolean;
}

export default function LoadingSpinner({ label, fullscreen = false }: Props) {
  return (
    <View style={[styles.container, fullscreen && styles.fullscreen]}>
      <ActivityIndicator size="large" color={COLORS.accent} />
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    padding: SPACING.xl,
  },
  fullscreen: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  label: {
    color: COLORS.textMuted,
    fontSize: 13,
    marginTop: SPACING.sm,
  },
});
