import { logger } from "firebase-functions";
import { errorCodeOf } from "./errors";

export type CommandOutcome =
  | "applied"
  | "already_applied"
  | "rejected"
  | "failed";

export interface CommandLogContext {
  command: string;
  callerUid: string;
  targetId: string;
  startedAtMs: number;
  release: string;
}

export interface CommandLogEntry {
  command: string;
  callerUid: string;
  targetId: string;
  outcome: CommandOutcome;
  latencyMs: number;
  release: string;
  errorCode?: string;
}

export function currentReleaseIdentifier(
  environment: NodeJS.ProcessEnv = process.env
): string {
  if (environment.K_REVISION) return environment.K_REVISION;
  if (environment.FUNCTIONS_EMULATOR === "true") return "emulator";
  return "unknown";
}

export function createCommandLogContext(
  command: string,
  callerUid: string,
  targetId: string,
  nowMs = Date.now()
): CommandLogContext {
  return {
    command,
    callerUid,
    targetId,
    startedAtMs: nowMs,
    release: currentReleaseIdentifier(),
  };
}

export function buildCommandLogEntry(
  context: CommandLogContext,
  outcome: CommandOutcome,
  nowMs = Date.now(),
  error?: unknown
): CommandLogEntry {
  const entry: CommandLogEntry = {
    command: context.command,
    callerUid: context.callerUid,
    targetId: context.targetId,
    outcome,
    latencyMs: Math.max(0, nowMs - context.startedAtMs),
    release: context.release,
  };
  if (error !== undefined) entry.errorCode = errorCodeOf(error);
  return entry;
}

export function logCommandSuccess(
  context: CommandLogContext,
  outcome: Extract<CommandOutcome, "applied" | "already_applied">
): void {
  logger.info("command.completed", buildCommandLogEntry(context, outcome));
}

export function logCommandFailure(
  context: CommandLogContext,
  error: unknown,
  outcome: Extract<CommandOutcome, "rejected" | "failed"> = "failed"
): void {
  logger.error(
    "command.failed",
    buildCommandLogEntry(context, outcome, Date.now(), error)
  );
}
