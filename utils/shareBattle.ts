import { Share } from "react-native";
import { showAlert, copyToClipboard } from "@/utils/alert";
import { getBattleWinner, getTimeRemainingLabel } from "@/hooks/useBattles";
import type { Battle } from "@/types";

/**
 * Battle sharing — the viral loop.
 *
 * WEB SAFETY
 * ──────────
 * React Native's `Share` delegates to `navigator.share` on web and REJECTS
 * outright in any browser that doesn't implement it (or outside a secure
 * context). Calling it bare meant Share buttons silently did nothing in the
 * browser. Every share here falls back to the clipboard and tells the user.
 *
 * LINKS
 * ─────
 * The only deep link Momentum actually resolves is the app scheme
 * (`momentum://`, declared in app.config.js). There is no public web URL for a
 * battle, and there is no /battle/[id] route — so shares link to the app and,
 * where it helps, to an athlete's profile route that genuinely exists. No
 * fabricated URLs.
 */

function playerName(name?: string): string {
  return name?.trim() || "an athlete";
}

/** Vote split from stored counters. Null percentages when nobody has voted. */
function split(battle: Battle): {
  total: number;
  percentA: number | null;
  percentB: number | null;
} {
  const votesA = Math.max(0, battle.votesA ?? 0);
  const votesB = Math.max(0, battle.votesB ?? 0);
  const total = votesA + votesB;
  if (total === 0) return { total: 0, percentA: null, percentB: null };
  const percentA = Math.round((votesA / total) * 100);
  return { total, percentA, percentB: 100 - percentA };
}

/**
 * Message for a battle that is still open for voting.
 * Includes the live score only when votes actually exist.
 */
export function getBattleShareMessage(battle: Battle): string {
  const playerA = playerName(battle.playerA?.username);
  const playerB = playerName(battle.playerB?.username);
  const category = battle.category?.trim() || "Highlights";
  const matchup = battle.playerB
    ? `${playerA} vs ${playerB}`
    : `${playerA}'s open challenge`;
  const { total, percentA, percentB } = split(battle);
  const remaining = getTimeRemainingLabel(battle);

  const lines = [`Vote on this ${category} battle in Momentum: ${matchup}.`];
  if (total > 0 && percentA !== null) {
    lines.push(
      `Right now it's ${percentA}% – ${percentB}% from ${total} ${total === 1 ? "vote" : "votes"}.`
    );
  }
  if (remaining && remaining !== "Ended") lines.push(`${remaining}.`);
  lines.push("Download Momentum, sign up, and help decide who wins.");
  lines.push("Open Momentum: momentum://");
  return lines.join("\n");
}

/**
 * Message for a finished battle. States the winner from the stored result —
 * `getBattleWinner` prefers the server-written `winner` field and only falls
 * back to comparing stored vote counts.
 */
export function getBattleResultShareMessage(battle: Battle): string {
  const playerA = playerName(battle.playerA?.username);
  const playerB = playerName(battle.playerB?.username);
  const category = battle.category?.trim() || "Highlights";
  const { total, percentA, percentB } = split(battle);
  const outcome = getBattleWinner(battle);

  const lines = [`${playerA} vs ${playerB} — ${category} battle on Momentum.`];

  if (outcome === "tie") {
    lines.push("It ended in a tie.");
  } else if (outcome && typeof outcome === "object") {
    const winnerName = playerName(outcome.username);
    const winnerIsA = outcome.userId === battle.playerA?.userId;
    const winnerPercent = winnerIsA ? percentA : percentB;
    lines.push(
      winnerPercent !== null
        ? `${winnerName} won with ${winnerPercent}%.`
        : `${winnerName} won.`
    );
  }

  if (total > 0) {
    lines.push(`${total} ${total === 1 ? "vote" : "votes"} cast.`);
  }
  lines.push("See the highlights and battle back on Momentum.");
  lines.push("Open Momentum: momentum://");
  return lines.join("\n");
}

/**
 * Present the share sheet, falling back to the clipboard.
 * Never throws — a failed share reports itself rather than doing nothing.
 */
async function presentShare(title: string, message: string): Promise<void> {
  try {
    await Share.share({ title, message });
  } catch {
    const copied = await copyToClipboard(message);
    showAlert(
      copied ? "Copied" : "Sharing unavailable",
      copied
        ? "The battle is on your clipboard — paste it anywhere."
        : "Sharing isn't supported in this browser. Try the Momentum app."
    );
  }
}

export async function shareBattle(battle: Battle): Promise<void> {
  await presentShare("Momentum Battle", getBattleShareMessage(battle));
}

export async function shareBattleResult(battle: Battle): Promise<void> {
  await presentShare("Momentum Battle Result", getBattleResultShareMessage(battle));
}
