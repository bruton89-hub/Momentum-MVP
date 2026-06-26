export const FINALIZE_BATTLE_COMMAND = "finalizeBattle" as const;

export interface FinalizeBattleRequest {
  battleId: string;
}

export interface FinalizeBattleResponse {
  battleId: string;
  status: "finalized" | "already_recorded";
  winner: string | null;
}
