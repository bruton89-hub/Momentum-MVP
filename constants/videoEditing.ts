export type VideoAudioTrackId =
  | "hype"
  | "cinematic"
  | "victory"
  | "chill"
  | "intense";

export interface VideoAudioTrack {
  id: VideoAudioTrackId;
  label: string;
  asset: number;
}

export const VIDEO_AUDIO_TRACKS: VideoAudioTrack[] = [
  {
    id: "hype",
    label: "Hype",
    asset: require("../assets/audio/hype.wav"),
  },
  {
    id: "cinematic",
    label: "Cinematic",
    asset: require("../assets/audio/cinematic.wav"),
  },
  {
    id: "victory",
    label: "Victory",
    asset: require("../assets/audio/victory.wav"),
  },
  {
    id: "chill",
    label: "Chill",
    asset: require("../assets/audio/chill.wav"),
  },
  {
    id: "intense",
    label: "Intense",
    asset: require("../assets/audio/intense.wav"),
  },
];

export interface VideoEditSettings {
  trimStartSeconds: number;
  trimEndSeconds: number | null;
  audioTrackId: VideoAudioTrackId | null;
  textOverlay: string;
}

export interface PostVideoEdit {
  music: VideoAudioTrackId | null;
  trimStart: number;
  trimEnd: number | null;
  textOverlay: string;
  coverUri: string | null;
}

export const EMPTY_VIDEO_EDIT: VideoEditSettings = {
  trimStartSeconds: 0,
  trimEndSeconds: null,
  audioTrackId: null,
  textOverlay: "",
};

export function hasVideoEdits(settings: VideoEditSettings): boolean {
  return (
    settings.trimStartSeconds > 0 ||
    settings.trimEndSeconds !== null ||
    settings.audioTrackId !== null ||
    settings.textOverlay.trim().length > 0
  );
}
