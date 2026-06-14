import React, { useEffect, useState } from "react";
import { Image, View, Text, StyleSheet } from "react-native";
import { COLORS, RADIUS } from "@/constants/theme";

interface Props {
  uri?: string | null;
  username?: string;
  size?: number;
}

export default function AvatarImage({ uri, username = "?", size = 40 }: Props) {
  const [failed, setFailed] = useState(false);

  const initial = (username?.[0] ?? "?").toUpperCase();

  useEffect(() => {
    setFailed(false);
  }, [uri]);

  if (!uri || failed) {
    return (
      <View
        style={[
          styles.fallback,
          { width: size, height: size, borderRadius: size / 2 },
        ]}
      >
        <Text style={[styles.initial, { fontSize: size * 0.38 }]}>{initial}</Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={{ width: size, height: size, borderRadius: size / 2 }}
      onError={() => {
        setFailed(true);
      }}
    />
  );
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: COLORS.accentFaint,
    borderWidth: 1,
    borderColor: COLORS.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  initial: {
    color: COLORS.accent,
    fontWeight: "700",
  },
});
