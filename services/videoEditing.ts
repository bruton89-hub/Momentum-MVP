import { auth } from "@/config/firebase";
import type { VideoEditSettings } from "@/constants/videoEditing";

interface RenderVideoResponse {
  mediaUrl: string;
  outputObjectPath: string;
}

export async function renderEditedVideo(input: {
  sourceObjectPath: string;
  settings: VideoEditSettings;
}): Promise<RenderVideoResponse> {
  const rendererUrl = process.env.EXPO_PUBLIC_VIDEO_RENDERER_URL?.trim();
  if (!rendererUrl) {
    throw new Error(
      "Video editing is not configured. Set EXPO_PUBLIC_VIDEO_RENDERER_URL to the deployed renderer URL."
    );
  }

  const user = auth.currentUser;
  if (!user) {
    throw new Error("You must be signed in to edit a video.");
  }

  const idToken = await user.getIdToken();
  const response = await fetch(`${rendererUrl.replace(/\/$/, "")}/render`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sourceObjectPath: input.sourceObjectPath,
      trimStartSeconds: input.settings.trimStartSeconds,
      trimEndSeconds: input.settings.trimEndSeconds,
      audioTrackId: input.settings.audioTrackId,
      textOverlay: input.settings.textOverlay.trim(),
    }),
  });

  const body = (await response.json().catch(() => null)) as
    | (Partial<RenderVideoResponse> & { error?: string })
    | null;
  if (!response.ok || !body?.mediaUrl || !body.outputObjectPath) {
    throw new Error(body?.error || "Could not render the edited video.");
  }

  return {
    mediaUrl: body.mediaUrl,
    outputObjectPath: body.outputObjectPath,
  };
}
