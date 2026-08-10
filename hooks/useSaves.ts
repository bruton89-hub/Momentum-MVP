import { useCallback, useEffect, useState } from "react";
import {
  fetchSavedPostIdSet,
  fetchSavedPosts,
  setPostSaved,
} from "@/services/saveRepository";
import { subscribeToPostDeletions } from "@/services/postDeletion";
import type { Post } from "@/types";

/**
 * Saved-post state, shared process-wide.
 *
 * PostCard renders in the Home feed, the post detail modal, and profile grids.
 * Threading save state through every one of those as props would mean three
 * screens passing a prop they don't otherwise care about, and any screen that
 * forgot would render a save button that silently did nothing — which is the
 * exact failure mode this replaces. A single module-level store with
 * subscriptions keeps every mounted card in sync from one write instead.
 */

let savedIds = new Set<string>();
let hydratedForUserId: string | null = null;
let hydration: Promise<void> | null = null;
const listeners = new Set<(ids: Set<string>) => void>();

function publish(next: Set<string>): void {
  savedIds = next;
  listeners.forEach((listener) => listener(next));
}

/** Load this user's saves once per session; repeat callers share the promise. */
function hydrate(userId: string | null): Promise<void> {
  if (!userId) {
    if (hydratedForUserId !== null) {
      hydratedForUserId = null;
      hydration = null;
      publish(new Set());
    }
    return Promise.resolve();
  }
  if (hydratedForUserId === userId && hydration) return hydration;

  hydratedForUserId = userId;
  hydration = fetchSavedPostIdSet(userId)
    .then((ids) => {
      // A user switch mid-flight must not publish the previous user's saves.
      if (hydratedForUserId === userId) publish(ids);
    })
    .catch(() => undefined);
  return hydration;
}

/** Drop a deleted post from saves everywhere — no stale bookmark rows. */
subscribeToPostDeletions((postId) => {
  if (!savedIds.has(postId)) return;
  const next = new Set(savedIds);
  next.delete(postId);
  publish(next);
});

async function applyToggle(
  postId: string,
  currentUserId: string
): Promise<boolean> {
  const wasSaved = savedIds.has(postId);
  const next = new Set(savedIds);
  if (wasSaved) next.delete(postId);
  else next.add(postId);
  publish(next);

  try {
    await setPostSaved(postId, currentUserId, !wasSaved);
    return !wasSaved;
  } catch (err) {
    console.error("[useSaves] toggle failed — reverting", err);
    const reverted = new Set(savedIds);
    if (wasSaved) reverted.add(postId);
    else reverted.delete(postId);
    publish(reverted);
    return wasSaved;
  }
}

/**
 * Save state for ONE post.
 *
 * Deliberately scoped to a single id rather than handing cards the whole Set:
 * a feed has ~24 PostCards mounted, and a shared-Set subscription would
 * re-render every one of them on every save. Here each card only re-renders
 * when its own membership flips — `setSaved` with an unchanged boolean bails
 * out inside React, so the other 23 cards never touch the renderer.
 *
 * `toggle` applies optimistically and reverts on failure, so the bookmark icon
 * always reflects what the server actually holds.
 */
export function usePostSave(postId: string, currentUserId: string | null) {
  const [saved, setSaved] = useState(() => savedIds.has(postId));

  useEffect(() => {
    const listener = (next: Set<string>) => {
      const isSaved = next.has(postId);
      setSaved((prev) => (prev === isSaved ? prev : isSaved));
    };
    listeners.add(listener);
    listener(savedIds);
    void hydrate(currentUserId).then(() => listener(savedIds));
    return () => {
      listeners.delete(listener);
    };
  }, [postId, currentUserId]);

  const toggle = useCallback(async (): Promise<boolean> => {
    if (!currentUserId) return false;
    return applyToggle(postId, currentUserId);
  }, [postId, currentUserId]);

  return { saved, toggle, canSave: !!currentUserId };
}

/** Full saved-post documents, for the profile's Saved tab. */
export function useSavedPosts(currentUserId: string | null) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!currentUserId) {
      setPosts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setPosts(await fetchSavedPosts(currentUserId));
    } catch (err) {
      console.error("[useSavedPosts] load failed", err);
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Unsaving from anywhere should remove the row immediately rather than
  // waiting for the next tab visit to re-query.
  useEffect(() => {
    const listener = (next: Set<string>) => {
      setPosts((current) => current.filter((post) => next.has(post.id)));
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return { posts, loading, refresh: load };
}
