export const SET_POST_LIKE_COMMAND = "setPostLike" as const;
export const CAST_BATTLE_VOTE_COMMAND = "castBattleVote" as const;
export const DELETE_POST_COMMAND = "deletePost" as const;

export type EngagementOutcome = "applied" | "already_applied";
export type BattleVoteSide = "A" | "B";

export interface SetPostLikeRequest {
  postId: string;
  liked: boolean;
  clientMutationId: string;
}

export interface SetPostLikeResponse {
  postId: string;
  liked: boolean;
  likesCount: number;
  outcome: EngagementOutcome;
}

export interface CastBattleVoteRequest {
  battleId: string;
  side: BattleVoteSide;
  clientMutationId: string;
}

export interface CastBattleVoteResponse {
  battleId: string;
  side: BattleVoteSide;
  votesA: number;
  votesB: number;
  outcome: EngagementOutcome;
}

export interface DeletePostRequest {
  postId: string;
}

export interface DeletePostResponse {
  postId: string;
  outcome: EngagementOutcome;
  deleted: {
    comments: number;
    likes: number;
    notifications: number;
  };
  mediaCleanupComplete: boolean;
  mediaRetainedForBattleHistory: boolean;
}
