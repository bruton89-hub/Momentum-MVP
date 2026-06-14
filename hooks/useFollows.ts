import { useState, useCallback, useEffect } from "react";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/config/firebase";

// ─── Document ID convention ───────────────────────────────────────────────────
// follows/{followerId}_{followingId}
// Fields: followerId, followingId, createdAt
// Using a compound doc ID prevents duplicate follows and allows cheap existence checks.

function followDocId(followerId: string, followingId: string): string {
  return `${followerId}_${followingId}`;
}

// ─── Fetch all followed user IDs for a given user ────────────────────────────
// Wrapped in try/catch: the `follows` collection may not have deployed Firestore
// rules yet. Failures must never block the feed from rendering.

export async function fetchFollowedIds(userId: string): Promise<Set<string>> {
  try {
    const snap = await getDocs(
      query(collection(db, "follows"), where("followerId", "==", userId))
    );
    const ids = new Set<string>();
    snap.forEach((d) => {
      const followingId = (d.data() as { followingId: string }).followingId;
      if (followingId) ids.add(followingId);
    });
    console.log("[fetchFollowedIds] loaded", ids.size, "followed ids for", userId);
    return ids;
  } catch (err) {
    // Permission denied fires here if firestore.rules has no `follows` rule.
    const code = (err as { code?: string })?.code ?? "unknown";
    console.error("[fetchFollowedIds] FAILED — code:", code, err);
    // Return empty set so the feed still renders; Follow buttons may not reflect
    // server state until rules are deployed.
    return new Set<string>();
  }
}

// ─── Hook: manages follow/unfollow state for the current user ─────────────────

export function useFollows(currentUserId: string | null) {
  const [followedIds, setFollowedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!currentUserId) {
      setFollowedIds(new Set());
      setLoading(false);
      return;
    }
    setLoading(true);
    const ids = await fetchFollowedIds(currentUserId);
    setFollowedIds(ids);
    setLoading(false);
  }, [currentUserId]);

  useEffect(() => {
    load();
  }, [load]);

  // Follow a user — optimistic update, revert on failure
  const follow = useCallback(
    async (targetUserId: string) => {
      // Guard: need both IDs, cannot follow self, cannot follow empty string
      if (!currentUserId || !targetUserId || currentUserId === targetUserId) return;

      const docId = followDocId(currentUserId, targetUserId);
      console.log("[follow] currentUserId:", currentUserId);
      console.log("[follow] targetUserId:", targetUserId);
      console.log("[follow] docId:", docId);

      // Optimistic: add immediately so UI reflects intent before Firestore confirms
      setFollowedIds((prev) => new Set([...prev, targetUserId]));

      try {
        await setDoc(
          doc(db, "follows", docId),
          {
            followerId: currentUserId,
            followingId: targetUserId,
            createdAt: serverTimestamp(),
          }
        );
        console.log("[follow] create success — docId:", docId);
      } catch (err) {
        const code = (err as { code?: string })?.code ?? "unknown";
        console.error("[follow] FAILED — code:", code, "error:", err);
        // Revert optimistic update so UI accurately shows the true state
        setFollowedIds((prev) => {
          const next = new Set(prev);
          next.delete(targetUserId);
          return next;
        });
      }
    },
    [currentUserId]
  );

  // Unfollow a user — optimistic update, revert on failure
  const unfollow = useCallback(
    async (targetUserId: string) => {
      if (!currentUserId || !targetUserId) return;

      const docId = followDocId(currentUserId, targetUserId);
      console.log("[unfollow] currentUserId:", currentUserId);
      console.log("[unfollow] targetUserId:", targetUserId);
      console.log("[unfollow] docId:", docId);

      // Optimistic: remove immediately
      setFollowedIds((prev) => {
        const next = new Set(prev);
        next.delete(targetUserId);
        return next;
      });

      try {
        await deleteDoc(
          doc(db, "follows", docId)
        );
        console.log("[unfollow] delete success — docId:", docId);
      } catch (err) {
        const code = (err as { code?: string })?.code ?? "unknown";
        console.error("[unfollow] FAILED — code:", code, "error:", err);
        // Revert optimistic update
        setFollowedIds((prev) => new Set([...prev, targetUserId]));
      }
    },
    [currentUserId]
  );

  return { followedIds, loading, follow, unfollow, refresh: load };
}
