/** Lightweight development-only timing. Production builds compile to a no-op. */
export function startDevTimer(label: string, slowThresholdMs = 500): () => void {
  if (!__DEV__) return () => undefined;

  const startedAt = Date.now();
  return () => {
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= slowThresholdMs) {
      console.warn(`[perf] ${label} took ${elapsedMs}ms`);
    }
  };
}

type DevMetricValue = string | number | boolean;

/** Development-only structured timing for paths where cache/query context matters. */
export function startDevMetricTimer(
  label: string,
  slowThresholdMs = 500
): (details: Record<string, DevMetricValue>) => number {
  if (!__DEV__) return () => 0;

  const startedAt = Date.now();
  return (details) => {
    const elapsedMs = Date.now() - startedAt;
    const context = Object.entries(details)
      .map(([key, value]) => `${key}=${value}`)
      .join(" ");
    const message = `[perf] ${label} took ${elapsedMs}ms ${context}`.trim();
    if (elapsedMs >= slowThresholdMs) console.warn(message);
    else console.info(message);
    return elapsedMs;
  };
}
