import React, { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, LayoutChangeEvent } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useReducedMotion,
  withSpring,
} from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import { COLORS, FONTS, TYPE, SPACING } from "@/constants/theme";

export interface ProfileTabDef<K extends string> {
  key: K;
  label: string;
  icon?: React.ComponentProps<typeof Feather>["name"];
}

interface Props<K extends string> {
  tabs: readonly ProfileTabDef<K>[];
  activeKey: K;
  onChange: (key: K) => void;
}

/**
 * Profile navigation tabs — equal-width segments with a spring-animated
 * Momentum-green underline that slides between tabs on the UI thread.
 * Icons + labels give a second (non-color) indicator of the active tab.
 */
export default function ProfileTabs<K extends string>({
  tabs,
  activeKey,
  onChange,
}: Props<K>) {
  const [tabWidth, setTabWidth] = useState(0);
  const reducedMotion = useReducedMotion();
  const indicatorX = useSharedValue(0);

  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.key === activeKey)
  );

  useEffect(() => {
    if (tabWidth <= 0) return;
    const target = activeIndex * tabWidth;
    indicatorX.value = reducedMotion
      ? target
      : withSpring(target, { damping: 18, stiffness: 220 });
  }, [activeIndex, tabWidth, reducedMotion, indicatorX]);

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const width = event.nativeEvent.layout.width / Math.max(1, tabs.length);
      setTabWidth((prev) => (Math.abs(prev - width) < 1 ? prev : width));
    },
    [tabs.length]
  );

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: indicatorX.value }],
  }));

  return (
    <View style={styles.wrap} onLayout={handleLayout} accessibilityRole="tablist">
      <View style={styles.row}>
        {tabs.map((tab) => {
          const isActive = tab.key === activeKey;
          return (
            <Pressable
              key={tab.key}
              onPress={() => onChange(tab.key)}
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: isActive }}
              style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
            >
              {tab.icon ? (
                <Feather
                  name={tab.icon}
                  size={15}
                  color={isActive ? COLORS.textPrimary : COLORS.textMuted}
                />
              ) : null}
              <Text style={[styles.label, isActive && styles.labelActive]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {tabWidth > 0 && (
        <Animated.View
          style={[styles.indicator, { width: tabWidth }, indicatorStyle]}
          pointerEvents="none"
        >
          <View style={styles.indicatorBar} />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
  },
  row: { flexDirection: "row" },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: SPACING.md,
    minHeight: 44,
  },
  pressed: { opacity: 0.7 },
  label: {
    color: COLORS.textMuted,
    fontSize: TYPE.body,
    fontWeight: FONTS.semibold,
    letterSpacing: 0.3,
  },
  labelActive: {
    color: COLORS.textPrimary,
    fontWeight: FONTS.bold,
  },
  indicator: {
    position: "absolute",
    bottom: -1,
    left: 0,
    alignItems: "center",
  },
  indicatorBar: {
    width: "56%",
    height: 3,
    borderRadius: 3,
    backgroundColor: COLORS.accent,
  },
});
