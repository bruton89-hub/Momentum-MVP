import React, { useCallback } from "react";
import {
  Pressable,
  PressableProps,
  GestureResponderEvent,
  StyleProp,
  ViewStyle,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface Props extends Omit<PressableProps, "style"> {
  /** Scale applied while pressed. Default 0.88 — punchy, athletic feel. */
  scaleTo?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/**
 * Pressable with a Reanimated spring scale on press — the standard press
 * feedback for feed action buttons. Runs entirely on the UI thread, so it
 * never competes with JS-side feed work (no extra React re-renders).
 */
export default function PressableScale({
  scaleTo = 0.88,
  style,
  children,
  onPressIn,
  onPressOut,
  ...rest
}: Props) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(
    (event: GestureResponderEvent) => {
      scale.value = withSpring(scaleTo, { damping: 18, stiffness: 320 });
      onPressIn?.(event);
    },
    [onPressIn, scale, scaleTo]
  );

  const handlePressOut = useCallback(
    (event: GestureResponderEvent) => {
      scale.value = withSpring(1, { damping: 14, stiffness: 260 });
      onPressOut?.(event);
    },
    [onPressOut, scale]
  );

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[style, animatedStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}
