import React, { memo, useEffect, useState } from "react";
import { View, Image, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  interpolate,
  Extrapolation,
  useAnimatedStyle,
  useReducedMotion,
  SharedValue,
} from "react-native-reanimated";
import {
  COLORS,
  BANNER_SCRIM,
  bannerGradientForSport,
} from "@/constants/theme";

export const BANNER_HEIGHT = 176;

interface Props {
  /** Uploaded banner. Falsy → the sport gradient renders instead. */
  bannerUrl?: string | null;
  /** Drives the fallback gradient when there's no uploaded banner. */
  sport?: string | null;
  /** Profile scroll offset — drives stretch-on-overscroll and parallax. */
  scrollY?: SharedValue<number>;
}

/**
 * Profile banner backdrop.
 *
 * Two states, and the fallback is the important one: an athlete who has never
 * uploaded a banner still gets a deliberate, sport-coded header rather than an
 * empty bar. An uploaded image gets a scrim so the avatar, name, and badges
 * that overlap its lower half stay readable over any photo.
 *
 * The stretch-on-overscroll is scroll-linked on the UI thread — no state, no
 * re-renders, and it disables itself under Reduce Motion.
 */
function ProfileBanner({ bannerUrl, sport, scrollY }: Props) {
  const reducedMotion = useReducedMotion();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [bannerUrl]);

  const hasImage = !!bannerUrl && !failed;

  const stretchStyle = useAnimatedStyle(() => {
    if (!scrollY || reducedMotion) return {};
    // Negative offset = pull-to-refresh overscroll. Scale from the top edge so
    // the banner grows downward and never detaches from the status bar.
    const scale = interpolate(
      scrollY.value,
      [-140, 0],
      [1.45, 1],
      Extrapolation.CLAMP
    );
    // Gentle parallax on the way up: the banner drifts at half scroll speed.
    const translateY = interpolate(
      scrollY.value,
      [0, BANNER_HEIGHT],
      [0, BANNER_HEIGHT * 0.35],
      Extrapolation.CLAMP
    );
    return { transform: [{ translateY }, { scale }] };
  });

  return (
    <View style={styles.clip} pointerEvents="none">
      <Animated.View style={[styles.layer, stretchStyle]}>
        {hasImage ? (
          <>
            <Image
              source={{ uri: bannerUrl as string }}
              style={styles.image}
              resizeMode="cover"
              accessibilityIgnoresInvertColors
              onError={() => setFailed(true)}
            />
            <LinearGradient colors={BANNER_SCRIM} style={StyleSheet.absoluteFill} />
          </>
        ) : (
          <LinearGradient
            colors={[...bannerGradientForSport(sport)]}
            start={{ x: 0.1, y: 0 }}
            end={{ x: 0.9, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        )}
      </Animated.View>

      {/* Hairline fade into the page background — hides the seam between the
          banner and the identity block on both banner states. */}
      <LinearGradient
        colors={["rgba(0,0,0,0)", COLORS.background]}
        style={styles.footerFade}
      />
    </View>
  );
}

export default memo(ProfileBanner);

const styles = StyleSheet.create({
  clip: {
    height: BANNER_HEIGHT,
    overflow: "hidden",
    backgroundColor: COLORS.surfaceDeep,
  },
  layer: {
    ...StyleSheet.absoluteFillObject,
    // Extra height absorbs the parallax drift so no gap opens at the bottom.
    bottom: -BANNER_HEIGHT * 0.4,
  },
  image: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  footerFade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 64,
  },
});
