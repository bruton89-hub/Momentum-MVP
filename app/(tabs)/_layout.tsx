import React from "react";
import { Tabs, Redirect } from "expo-router";
import { Text, StyleSheet, View } from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS } from "@/constants/theme";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthStore } from "@/store/authStore";

// ─── Icon sizes ───────────────────────────────────────────────────────────────
const ICON_SIZE = 22;

// ─── Tab Icon wrapper ─────────────────────────────────────────────────────────
// Each tab button renders an icon + label pair. The Create tab is special:
// it uses a filled lime square with a black + rather than the outline style.
function TabIcon({
  children,
  label,
  focused,
  isCreate = false,
}: {
  children?: React.ReactNode;
  label: string;
  focused: boolean;
  isCreate?: boolean;
}) {
  if (isCreate) {
    // Brand-guide Create: rounded square with + inside, filled lime when active
    return (
      <View style={[styles.createBtn, focused && styles.createBtnActive]}>
        <Feather
          name="plus"
          size={20}
          color={focused ? COLORS.black : COLORS.textMuted}
        />
      </View>
    );
  }

  return (
    <View style={styles.iconWrap}>
      <View style={styles.iconInner}>
        {children}
      </View>
      <Text style={[styles.label, focused && styles.labelActive]}>{label}</Text>
    </View>
  );
}

// ─── Individual icon components ───────────────────────────────────────────────
// Brand guide: outline style (thin stroke, not filled) for inactive state.
// Active state: same icon in accent lime (#C6FF00).

/** Home tab — house outline from Feather, matches brand guide house icon */
function HomeIcon({ focused }: { focused: boolean }) {
  return (
    <Feather
      name="home"
      size={ICON_SIZE}
      color={focused ? COLORS.accent : COLORS.textMuted}
    />
  );
}

/**
 * Battles tab — crossed swords from MaterialCommunityIcons.
 * "sword-cross" is a direct match to the brand guide crossed-swords icon.
 */
function BattlesIcon({ focused }: { focused: boolean }) {
  return (
    <MaterialCommunityIcons
      name="sword-cross"
      size={ICON_SIZE + 2}
      color={focused ? COLORS.accent : COLORS.textMuted}
    />
  );
}

/** Profile tab — person outline from Feather, matches brand guide person icon */
function ProfileIcon({ focused }: { focused: boolean }) {
  return (
    <Feather
      name="user"
      size={ICON_SIZE}
      color={focused ? COLORS.accent : COLORS.textMuted}
    />
  );
}

// ─── Layout ───────────────────────────────────────────────────────────────────

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const userId = useAuthStore((state) => state.userId);
  const isLoading = useAuthStore((state) => state.isLoading);

  if (isLoading) return null;
  if (!userId) return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: COLORS.navBg,
          borderTopColor: COLORS.cardBorder,
          borderTopWidth: 1,
          height: 60 + insets.bottom,
          paddingBottom: insets.bottom,
          paddingTop: 6,
        },
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ focused }) => (
            <TabIcon label="Home" focused={focused}>
              <HomeIcon focused={focused} />
            </TabIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: "Create",
          tabBarIcon: ({ focused }) => (
            <TabIcon label="Create" focused={focused} isCreate />
          ),
        }}
      />
      <Tabs.Screen
        name="battles"
        options={{
          title: "Battles",
          tabBarIcon: ({ focused }) => (
            <TabIcon label="Battles" focused={focused}>
              <BattlesIcon focused={focused} />
            </TabIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          // href ensures the tab button always navigates to the own-profile tab
          // route, not to any previously-pushed /profile/[userId] stack screen.
          href: "/(tabs)/profile",
          tabBarIcon: ({ focused }) => (
            <TabIcon label="Profile" focused={focused}>
              <ProfileIcon focused={focused} />
            </TabIcon>
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  // ── Standard tab icon (icon + label) ────────────────────────────────────────
  iconWrap: {
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  iconInner: {
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 10,
    color: COLORS.textMuted,
    fontWeight: FONTS.semibold,
    letterSpacing: 0.3,
  },
  labelActive: {
    color: COLORS.accent,
    fontWeight: FONTS.bold,
  },

  // ── Create tab — distinctive lime rounded-square button ───────────────────
  // Matches brand-guide "Create" icon: square with + inside.
  createBtn: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.sm,
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: COLORS.inputBorder,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  createBtnActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
});
