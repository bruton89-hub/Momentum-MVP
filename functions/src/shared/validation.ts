import type { BattleVoteSide } from "../contracts/engagement";
import { commandError } from "./errors";

export function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw commandError("invalid-argument", "Request data must be an object.");
  }
  return value as Record<string, unknown>;
}

export function requireString(
  value: unknown,
  field: string,
  options: { maxLength?: number; trim?: boolean } = {}
): string {
  if (typeof value !== "string") {
    throw commandError("invalid-argument", `${field} must be a string.`);
  }

  const result = options.trim === false ? value : value.trim();
  if (result.length === 0) {
    throw commandError("invalid-argument", `${field} is required.`);
  }
  if (options.maxLength !== undefined && result.length > options.maxLength) {
    throw commandError(
      "invalid-argument",
      `${field} must be at most ${options.maxLength} characters.`
    );
  }
  return result;
}

export function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw commandError("invalid-argument", `${field} must be a boolean.`);
  }
  return value;
}

export function requireBattleVoteSide(value: unknown): BattleVoteSide {
  if (value !== "A" && value !== "B") {
    throw commandError("invalid-argument", "side must be A or B.");
  }
  return value;
}

export function requireClientMutationId(value: unknown): string {
  const mutationId = requireString(value, "clientMutationId", {
    maxLength: 128,
  });
  if (!/^[A-Za-z0-9._:-]+$/.test(mutationId)) {
    throw commandError(
      "invalid-argument",
      "clientMutationId contains unsupported characters."
    );
  }
  return mutationId;
}
