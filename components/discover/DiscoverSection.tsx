import React, { memo } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { COLORS, SPACING, FONTS, TYPE, HIT_SLOP } from "@/constants/theme";

interface Props {
  title: string;
  subtitle?: string;
  /** Omitted entirely when there is no expanded view — never a dead control. */
  onSeeAll?: () => void;
  /** Count shown beside the title. Real length of the section's data. */
  count?: number;
  children: React.ReactNode;
}

/**
 * Section wrapper for a Discover rail: title, honest count, and a See All
 * affordance that is only rendered when a real destination exists.
 */
function DiscoverSection({ title, subtitle, onSeeAll, count, children }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <View style={styles.titleRow}>
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
            {typeof count === "number" && count > 0 && (
              <View style={styles.countPill}>
                <Text style={styles.countText}>{count}</Text>
              </View>
            )}
          </View>
          {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        </View>

        {onSeeAll && (
          <Pressable
            onPress={onSeeAll}
            hitSlop={HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={`See all ${title}`}
            style={({ pressed }) => [styles.seeAll, pressed && styles.pressed]}
          >
            <Text style={styles.seeAllText}>See all</Text>
            <Feather name="chevron-right" size={14} color={COLORS.accent} />
          </Pressable>
        )}
      </View>
      {children}
    </View>
  );
}

export default memo(DiscoverSection);

const styles = StyleSheet.create({
  wrap: { marginTop: SPACING.xl },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
  },
  headerText: { flex: 1, gap: 2 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  title: {
    color: COLORS.textPrimary,
    fontSize: TYPE.title3,
    fontWeight: FONTS.heavy,
    letterSpacing: 0.2,
  },
  countPill: {
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    backgroundColor: COLORS.accentFaint,
    borderWidth: 1,
    borderColor: COLORS.accentBorderFaint,
    alignItems: "center",
  },
  countText: {
    color: COLORS.accent,
    fontSize: TYPE.micro,
    fontWeight: FONTS.heavy,
  },
  subtitle: {
    color: COLORS.textMuted,
    fontSize: TYPE.small,
    lineHeight: 16,
  },
  seeAll: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    minHeight: 32,
    paddingLeft: SPACING.sm,
  },
  seeAllText: {
    color: COLORS.accent,
    fontSize: TYPE.footnote,
    fontWeight: FONTS.bold,
  },
  pressed: { opacity: 0.65 },
});
