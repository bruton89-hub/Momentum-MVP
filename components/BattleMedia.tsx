import React, { useEffect, useMemo, useState } from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import { ResizeMode, Video } from "expo-av";
import MediaTile from "./MediaTile";
import {
  isVideoMedia,
  normalizeFirebaseStorageUrl,
} from "@/utils/media";

interface Props {
  uri?: string | null;
  mediaType?: "image" | "video";
  playing: boolean;
  style?: StyleProp<ViewStyle>;
  context?: string;
}

export default function BattleMedia({
  uri,
  mediaType,
  playing,
  style,
  context = "BattleMedia",
}: Props) {
  const [videoError, setVideoError] = useState(false);
  const normalizedUri = useMemo(() => normalizeFirebaseStorageUrl(uri), [uri]);
  const isVideo = isVideoMedia(normalizedUri || uri, mediaType);

  useEffect(() => {
    setVideoError(false);
  }, [normalizedUri]);

  if (!isVideo || !playing || !normalizedUri || videoError) {
    return (
      <MediaTile
        uri={uri || null}
        mediaType={mediaType}
        style={style}
        context={context}
      />
    );
  }

  return (
    <View style={[styles.root, style]}>
      <Video
        source={{ uri: normalizedUri }}
        style={StyleSheet.absoluteFillObject}
        resizeMode={ResizeMode.COVER}
        shouldPlay
        isLooping={false}
        isMuted
        useNativeControls={false}
        onError={() => setVideoError(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    overflow: "hidden",
  },
});
