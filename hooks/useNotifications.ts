import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchNotificationsForUser,
  fetchUnreadNotificationCount,
  markNotificationRead,
  markNotificationsRead,
} from "@/services/notificationRepository";
import type { MomentumNotification } from "@/types";

const PAGE_SIZE = 20;

/**
 * Notification list for the current user. Follows the discovery feed's
 * pagination pattern: one index-free fetch fills a pool (≤100), and
 * `loadMore` widens the visible window for infinite scroll.
 */
export function useNotifications(userId: string | null) {
  const [pool, setPool] = useState<MomentumNotification[]>([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const fetch = useCallback(
    async (isRefresh = false) => {
      if (!userId) {
        setPool([]);
        setLoading(false);
        return;
      }
      const requestId = ++requestIdRef.current;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const fetched = await fetchNotificationsForUser(userId);
        if (requestId !== requestIdRef.current) return;
        setPool(fetched);
        setVisibleCount(PAGE_SIZE);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : "Couldn't load notifications.");
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [userId]
  );

  useEffect(() => {
    void fetch();
    return () => {
      requestIdRef.current += 1;
    };
  }, [fetch]);

  const refresh = useCallback(() => fetch(true), [fetch]);
  const loadMore = useCallback(() => {
    setVisibleCount((count) => Math.min(count + PAGE_SIZE, pool.length));
  }, [pool.length]);

  // Mark one read — optimistic (a read flag reverting is harmless noise).
  const markRead = useCallback((id: string) => {
    setPool((prev) =>
      prev.map((n) => (n.id === id && !n.read ? { ...n, read: true } : n))
    );
    markNotificationRead(id).catch(() => undefined);
  }, []);

  const markAllRead = useCallback(() => {
    const unreadIds: string[] = [];
    setPool((prev) => {
      prev.forEach((n) => {
        if (!n.read) unreadIds.push(n.id);
      });
      return unreadIds.length > 0
        ? prev.map((n) => (n.read ? n : { ...n, read: true }))
        : prev;
    });
    if (unreadIds.length > 0) {
      markNotificationsRead(unreadIds).catch(() => undefined);
    }
  }, []);

  const notifications = useMemo(
    () => pool.slice(0, visibleCount),
    [pool, visibleCount]
  );
  const unreadCount = useMemo(
    () => pool.reduce((sum, n) => (n.read ? sum : sum + 1), 0),
    [pool]
  );

  return {
    notifications,
    unreadCount,
    hasMore: visibleCount < pool.length,
    loading,
    refreshing,
    error,
    refresh,
    loadMore,
    markRead,
    markAllRead,
  };
}

/**
 * Lightweight unread badge count — a single server-side aggregate read, no
 * documents downloaded. `refresh` is exposed so the host can re-check on
 * screen focus.
 */
export function useUnreadNotificationCount(userId: string | null) {
  const [count, setCount] = useState(0);
  const requestIdRef = useRef(0);
  const permissionDeniedUidRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!userId) {
      permissionDeniedUidRef.current = null;
      setCount(0);
      return;
    }
    // A denied badge query is noncritical. Do not retry it on every screen
    // focus; signing out/in (a UID transition) resets this circuit breaker.
    if (permissionDeniedUidRef.current === userId) return;
    const result = await fetchUnreadNotificationCount(userId);
    if (requestId === requestIdRef.current) {
      if (result.permissionDenied) permissionDeniedUidRef.current = userId;
      setCount((prev) => (prev === result.count ? prev : result.count));
    }
  }, [userId]);

  useEffect(() => {
    if (permissionDeniedUidRef.current !== userId) {
      permissionDeniedUidRef.current = null;
    }
    void refresh();
    return () => {
      requestIdRef.current += 1;
    };
  }, [refresh]);

  return { count, refresh };
}
