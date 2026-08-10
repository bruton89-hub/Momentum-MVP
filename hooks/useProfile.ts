import { useState, useCallback, useEffect, useRef } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  updateDoc,
  where,
  serverTimestamp,
} from "firebase/firestore";
import type { FieldValue, Timestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { Platform } from "react-native";
import { db, storage } from "@/config/firebase";
import { startDevTimer } from "@/utils/performance";
import {
  loadMediaBlob,
  mediaSourceUri,
  type MediaUploadSource,
} from "@/utils/mediaUpload";
import type { UserProfile } from "@/types";

const MAX_AVATAR_BYTES = 10 * 1024 * 1024;
const MAX_BANNER_BYTES = 10 * 1024 * 1024;
const SUPPORTED_AVATAR_URI = /^(file|content|ph|assets-library|blob|data|https?):/i;

// ─── Search index fields ──────────────────────────────────────────────────────
// Firestore has no text search. Prefix matching is done with a range query
// (>= term, < term + ''), which requires a lowercased, trimmed copy of
// each searchable field — queries are case-sensitive and can only anchor at the
// start of a value.
//
// Written on every profile create and update so the index can never drift from
// the display values. `scripts/backfill-search-fields.js` covers existing docs.
export interface ProfileSearchFields {
  usernameLower: string;
  schoolLower: string;
  cityLower: string;
}

export function searchFieldsFor(input: {
  username?: string;
  school?: string;
  city?: string;
}): ProfileSearchFields {
  return {
    usernameLower: (input.username ?? "").trim().toLowerCase(),
    schoolLower: (input.school ?? "").trim().toLowerCase(),
    cityLower: (input.city ?? "").trim().toLowerCase(),
  };
}

// ─── Create or refresh a user profile ────────────────────────────────────────

export async function ensureUserProfile(
  userId: string,
  username: string,
  athleteType = "Other",
  avatar = "",
  bio = ""
): Promise<UserProfile> {
  const ref = doc(db, "users", userId);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    return normalizeUserProfile(userId, snap.data());
  }
  const profile: Omit<UserProfile, "userId"> = {
    username,
    avatar,
    avatarUrl: avatar,
    athleteType,
    sport: athleteType,
    bio,
    posts: 0,
    wins: 0,
    losses: 0,
    createdAt: null,
  };
  await setDoc(ref, {
    ...profile,
    ...searchFieldsFor({ username }),
    createdAt: serverTimestamp(),
  });
  return { userId, ...profile };
}

export async function isUsernameTaken(username: string, excludeUserId?: string): Promise<boolean> {
  // Case-insensitive: "ChrisFly" and "chrisfly" are the same handle to a human,
  // so treating them as distinct would let one athlete impersonate another.
  const snap = await getDocs(
    query(
      collection(db, "users"),
      where("usernameLower", "==", username.trim().toLowerCase()),
      limit(5)
    )
  );
  return snap.docs.some((userDoc) => userDoc.id !== excludeUserId);
}

export async function fetchUserProfile(userId: string): Promise<UserProfile | null> {
  try {
    const snap = await getDoc(doc(db, "users", userId));
    if (!snap.exists()) return null;
    return normalizeUserProfile(userId, snap.data());
  } catch (err) {
    console.error("Profile read failed", err);
    return null;
  }
}

export interface UserProfileUpdates {
  username?: string;
  bio?: string;
  sport?: string;
  athleteType?: string;
  avatarUrl?: string;
  avatar?: string;
  bannerUrl?: string;
  // ── Prefix-search index (see searchFieldsFor). Always written alongside the
  //    display fields they mirror so the two can never drift apart.
  usernameLower?: string;
  schoolLower?: string;
  cityLower?: string;
  // ── Athlete identity. Written as "" to clear a field rather than deleted, so
  //    normalizeUserProfile's `|| undefined` collapses them back to absent.
  position?: string;
  school?: string;
  teamName?: string;
  city?: string;
  state?: string;
  gradYear?: string;
  updatedAt?: FieldValue;
}

export async function updateUserProfile(
  userId: string,
  updates: UserProfileUpdates
): Promise<void> {
  if (!userId.trim()) {
    throw new Error("You must be signed in to update your profile.");
  }
  await updateDoc(doc(db, "users", userId), { ...updates });
}

export async function uploadUserAvatar(source: MediaUploadSource, userId: string): Promise<string> {
  const safeUserId = userId.trim();
  const safeUri = mediaSourceUri(source).trim();
  if (!safeUserId) {
    throw new Error("You must be signed in to upload a profile image.");
  }
  if (!safeUri) {
    throw new Error("No profile image was selected.");
  }
  if (!SUPPORTED_AVATAR_URI.test(safeUri)) {
    throw new Error("The selected profile image has an invalid file URI.");
  }

  let blob: Blob | null = null;
  try {
    blob = await loadMediaBlob(source, Platform.OS);
    if (!blob.size) {
      throw new Error("The selected profile image is empty.");
    }
    if (blob.size >= MAX_AVATAR_BYTES) {
      throw new Error("Profile images must be smaller than 10 MB.");
    }
    if (blob.type && !blob.type.toLowerCase().startsWith("image/")) {
      throw new Error("The selected file is not an image.");
    }

    const storageRef = ref(storage, `profileImages/${safeUserId}/avatar.jpg`);
    await uploadBytes(storageRef, blob, {
      contentType: blob.type || "image/jpeg",
      customMetadata: { ownerId: safeUserId },
    });
    return getDownloadURL(storageRef);
  } catch (err) {
    console.error("[uploadUserAvatar] Profile image upload failed", {
      userId: safeUserId,
      uriScheme: safeUri.split(":")[0] || "unknown",
      platform: Platform.OS,
      blobSize: blob?.size,
      blobType: blob?.type,
      error: err,
    });
    throw err;
  } finally {
    // React Native's Blob has a close method that releases its native backing data.
    const close = (blob as (Blob & { close?: () => void }) | null)?.close;
    if (typeof close === "function") close.call(blob);
  }
}

/**
 * Upload a profile banner. Deliberately mirrors uploadUserAvatar — same
 * validation, same blob handling, same native Blob release — but writes to
 * `banners/{userId}/banner.jpg` so Storage rules can size- and type-gate the
 * two independently.
 */
export async function uploadUserBanner(source: MediaUploadSource, userId: string): Promise<string> {
  const safeUserId = userId.trim();
  const safeUri = mediaSourceUri(source).trim();
  if (!safeUserId) {
    throw new Error("You must be signed in to upload a banner.");
  }
  if (!safeUri) {
    throw new Error("No banner image was selected.");
  }
  if (!SUPPORTED_AVATAR_URI.test(safeUri)) {
    throw new Error("The selected banner has an invalid file URI.");
  }

  let blob: Blob | null = null;
  try {
    blob = await loadMediaBlob(source, Platform.OS);
    if (!blob.size) {
      throw new Error("The selected banner is empty.");
    }
    if (blob.size >= MAX_BANNER_BYTES) {
      throw new Error("Banners must be smaller than 10 MB.");
    }
    if (blob.type && !blob.type.toLowerCase().startsWith("image/")) {
      throw new Error("The selected file is not an image.");
    }

    const storageRef = ref(storage, `banners/${safeUserId}/banner.jpg`);
    await uploadBytes(storageRef, blob, {
      contentType: blob.type || "image/jpeg",
      customMetadata: { ownerId: safeUserId },
    });
    return getDownloadURL(storageRef);
  } catch (err) {
    console.error("[uploadUserBanner] Banner upload failed", {
      userId: safeUserId,
      uriScheme: safeUri.split(":")[0] || "unknown",
      platform: Platform.OS,
      blobSize: blob?.size,
      blobType: blob?.type,
      error: err,
    });
    throw err;
  } finally {
    const close = (blob as (Blob & { close?: () => void }) | null)?.close;
    if (typeof close === "function") close.call(blob);
  }
}

function normalizeUserProfile(userId: string, data: Record<string, unknown>): UserProfile {
  const avatarUrl = typeof data.avatarUrl === "string" ? data.avatarUrl : "";
  const legacyAvatar = typeof data.avatar === "string" ? data.avatar : "";
  const sport = typeof data.sport === "string" ? data.sport : "";
  const legacyAthleteType = typeof data.athleteType === "string" ? data.athleteType : "";

  const profile: UserProfile = {
    userId,
    username: typeof data.username === "string" ? data.username : "",
    avatar: avatarUrl || legacyAvatar,
    avatarUrl: avatarUrl || legacyAvatar,
    athleteType: sport || legacyAthleteType || "Other",
    sport: sport || legacyAthleteType || "Other",
    bio: typeof data.bio === "string" ? data.bio : "",
    posts: typeof data.posts === "number" ? data.posts : 0,
    wins: typeof data.wins === "number" ? data.wins : 0,
    losses: typeof data.losses === "number" ? data.losses : 0,
    bannerUrl: profileString(data.bannerUrl) || profileString(data.banner) || undefined,
    createdAt: (data.createdAt as Timestamp) ?? null,
    updatedAt: (data.updatedAt as Timestamp) ?? null,
    // ── Optional identity / status fields (alias-tolerant, never fabricated) ──
    position: profileString(data.position) || profileString(data.playerPosition) || undefined,
    school: profileString(data.school) || profileString(data.schoolName) || undefined,
    teamName: profileString(data.teamName) || profileString(data.team) || undefined,
    city: profileString(data.city) || undefined,
    state: profileString(data.state) || profileString(data.region) || undefined,
    gradYear: profileGradYear(data.gradYear ?? data.graduationYear ?? data.classOf),
    verified: data.verified === true || data.isVerified === true || undefined,
    coachVerified: data.coachVerified === true || undefined,
    momentumScore: typeof data.momentumScore === "number" ? data.momentumScore : undefined,
    tournamentChampion: data.tournamentChampion === true || undefined,
    topRanked: data.topRanked === true || undefined,
  };
  return profile;
}

function profileString(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function profileGradYear(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

// ─── Hook: load any profile by userId ────────────────────────────────────────

export function useProfile(userId: string | null) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  // Start true so the player profile shows a spinner on first render instead
  // of flashing "Athlete not found" for one frame before the fetch begins.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!userId) {
      // No userId — clear state and stop loading immediately
      setProfile(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const stopTimer = startDevTimer(`profile ${userId}`);
    try {
      const p = await fetchUserProfile(userId);
      if (requestId === requestIdRef.current) setProfile(p);
    } catch (err: unknown) {
      if (requestId === requestIdRef.current) {
        setError(err instanceof Error ? err.message : "Failed to load profile");
      }
    } finally {
      stopTimer();
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [userId]);

  // Auto-fetch whenever userId changes (or on mount).
  // Previously this hook had no useEffect, so it never fetched — the player
  // profile page would always show "Athlete not found" immediately.
  useEffect(() => {
    void load();
    return () => {
      requestIdRef.current += 1;
    };
  }, [load]);

  return { profile, loading, error, load };
}
