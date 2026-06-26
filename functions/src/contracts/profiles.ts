export const CLAIM_USERNAME_COMMAND = "claimUsernameAndCreateProfile" as const;
export const RENAME_USERNAME_COMMAND = "renameUsername" as const;

export type UsernameCommandOutcome = "applied" | "already_applied";

export interface ClaimUsernameAndCreateProfileRequest {
  username: string;
  athleteType: string;
  bio: string;
  clientMutationId: string;
}

export interface ClaimUsernameAndCreateProfileResponse {
  userId: string;
  username: string;
  normalizedUsername: string;
  outcome: UsernameCommandOutcome;
}

export interface RenameUsernameRequest {
  username: string;
  clientMutationId: string;
}

export interface RenameUsernameResponse {
  userId: string;
  username: string;
  normalizedUsername: string;
  outcome: UsernameCommandOutcome;
}
