import { useState, useCallback, useEffect } from "react";
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
import { db, storage } from "@/config/firebase";
import type { UserProfile } from "@/types";

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
  await setDoc(ref, { ...profile, createdAt: serverTimestamp() });
  return { userId, ...profile };
}

export async function isUsernameTaken(username: string, excludeUserId?: string): Promise<boolean> {
  const snap = await getDocs(
    query(collection(db, "users"), where("username", "==", username), limit(1))
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
  avatarUrl?: string;
  avatar?: string;
  updatedAt?: FieldValue;
}

export async function updateUserProfile(
  userId: string,
  updates: UserProfileUpdates
): Promise<void> {
  await updateDoc(doc(db, "users", userId), { ...updates });
}

export async function uploadUserAvatar(uri: string, userId: string): Promise<string> {
  try {
    const response = await fetch(uri);
    if (!response.ok) {
      throw new Error(`Avatar fetch failed with status ${response.status}`);
    }
    const blob = await response.blob();
    const ext = blob.type.split("/")[1]?.split(";")[0] || "jpg";
    const storageRef = ref(storage, `avatars/${userId}/${Date.now()}.${ext}`);
    await uploadBytes(storageRef, blob);
    return getDownloadURL(storageRef);
  } catch (err) {
    console.error("Profile avatar upload failed", err);
    throw err;
  }
}

function normalizeUserProfile(userId: string, data: Record<string, unknown>): UserProfile {
  const avatarUrl = typeof data.avatarUrl === "string" ? data.avatarUrl : "";
  const legacyAvatar = typeof data.avatar === "string" ? data.avatar : "";
  const sport = typeof data.sport === "string" ? data.sport : "";
  const legacyAthleteType = typeof data.athleteType === "string" ? data.athleteType : "";

  const profile = {
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
    createdAt: (data.createdAt as Timestamp) ?? null,
    updatedAt: (data.updatedAt as Timestamp) ?? null,
  };
  return profile;
}

// ─── Hook: load any profile by userId ────────────────────────────────────────

export function useProfile(userId: string | null) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  // Start true so the player profile shows a spinner on first render instead
  // of flashing "Athlete not found" for one frame before the fetch begins.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) {
      // No userId — clear state and stop loading immediately
      setProfile(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const p = await fetchUserProfile(userId);
      setProfile(p);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load profile");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Auto-fetch whenever userId changes (or on mount).
  // Previously this hook had no useEffect, so it never fetched — the player
  // profile page would always show "Athlete not found" immediately.
  useEffect(() => {
    load();
  }, [load]);

  return { profile, loading, error, load };
}
