export function isLatestGeneration(requestId: number, latestRequestId: number): boolean {
  return requestId === latestRequestId;
}

export function canCommitProfile(requestedUid: string, liveUid: string | null): boolean {
  return requestedUid.length > 0 && requestedUid === liveUid;
}

export function shouldPlayCreatePreview(
  userRequestedPlayback: boolean,
  screenFocused: boolean,
  appActive: boolean
): boolean {
  return userRequestedPlayback && screenFocused && appActive;
}
