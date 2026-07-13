import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchCommentsForPost,
  createComment,
  deleteComment,
} from "@/services/commentRepository";
import type { PostComment } from "@/types";

export interface CommentAuthor {
  userId: string;
  username: string;
  avatar: string;
}

/**
 * Comments for a single post.
 *
 * - Loads when `enabled` (sheet visible) and postId is set; resets on post change.
 * - `loadError` and `submitError` are tracked separately so a failed send
 *   never blanks an already-loaded list, and a failed load never blocks the
 *   composer.
 * - No optimistic rendering: a comment is inserted only after Firestore
 *   acknowledges the write (createComment resolves), using the returned
 *   document — deduped by id so a subsequent refresh can't duplicate it.
 */
export function useComments(postId: string | null, enabled: boolean) {
  const [comments, setComments] = useState<PostComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const submittingRef = useRef(false);

  const load = useCallback(async () => {
    if (!postId) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const fetched = await fetchCommentsForPost(postId);
      if (requestId !== requestIdRef.current) return;
      setComments(fetched);
      setLoaded(true);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      // Keep any cached comments visible; only surface the banner.
      setLoadError(
        err instanceof Error ? err.message : "Couldn't load comments."
      );
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [postId]);

  // Reset when the post changes; fetch on first open per post.
  useEffect(() => {
    setComments([]);
    setLoaded(false);
    setLoadError(null);
    setSubmitError(null);
  }, [postId]);

  useEffect(() => {
    if (enabled && postId && !loaded && !loading) {
      void load();
    }
    // `loading` intentionally omitted: it would re-arm mid-flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, postId, loaded, load]);

  const submit = useCallback(
    async (text: string, author: CommentAuthor): Promise<boolean> => {
      const trimmed = text.trim();
      if (!postId || !trimmed || submittingRef.current) return false;
      submittingRef.current = true;
      setSubmitting(true);
      setSubmitError(null);
      try {
        const accepted = await createComment({
          postId,
          userId: author.userId,
          username: author.username,
          avatar: author.avatar,
          text: trimmed,
        });
        // Insert the server-accepted comment, deduped by id.
        setComments((prev) =>
          prev.some((c) => c.id === accepted.id)
            ? prev
            : [accepted, ...prev]
        );
        return true;
      } catch (err) {
        setSubmitError(
          err instanceof Error ? err.message : "Couldn't post your comment."
        );
        return false;
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
      }
    },
    [postId]
  );

  const remove = useCallback(async (commentId: string): Promise<boolean> => {
    setDeletingId(commentId);
    try {
      await deleteComment(commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
      return true;
    } catch {
      return false;
    } finally {
      setDeletingId(null);
    }
  }, []);

  return {
    comments,
    loading,
    loaded,
    loadError,
    submitting,
    submitError,
    deletingId,
    refresh: load,
    submit,
    remove,
  };
}
