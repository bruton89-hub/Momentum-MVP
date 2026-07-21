import { useEffect, useState } from "react";
import { InteractionManager } from "react-native";

/**
 * Defers nonessential work until native navigation/modal interactions finish.
 * Resetting on `identity` prevents media or data from a previous item becoming
 * active while the next transition is still in progress.
 */
export function useInteractionReady(
  active: boolean,
  identity?: string | null
): boolean {
  const token = identity ?? "__interaction__";
  const [readyToken, setReadyToken] = useState<string | null>(null);

  useEffect(() => {
    setReadyToken(null);
    if (!active) return;

    const task = InteractionManager.runAfterInteractions(() => setReadyToken(token));
    return () => task.cancel();
  }, [active, token]);

  return active && readyToken === token;
}
