import { Share } from "react-native";
import type { Battle } from "@/types";

function playerName(name?: string): string {
  return name?.trim() || "an athlete";
}

export function getBattleShareMessage(battle: Battle): string {
  const playerA = playerName(battle.playerA?.username);
  const playerB = playerName(battle.playerB?.username);
  const category = battle.category?.trim() || "Highlights";
  const matchup = battle.playerB ? `${playerA} vs ${playerB}` : `${playerA}'s open challenge`;

  return [
    `Vote on this ${category} battle in Momentum: ${matchup}.`,
    "Download Momentum, sign up, and help decide who wins.",
    "Open Momentum: momentum://",
  ].join("\n");
}

export async function shareBattle(battle: Battle): Promise<void> {
  await Share.share({
    title: "Momentum Battle",
    message: getBattleShareMessage(battle),
  });
}
