import {
  HttpsError,
  type FunctionsErrorCode,
} from "firebase-functions/v2/https";

export const COMMAND_ERROR_CODES = [
  "unauthenticated",
  "invalid-argument",
  "not-found",
  "already-exists",
  "failed-precondition",
  "permission-denied",
  "aborted",
  "internal",
] as const satisfies readonly FunctionsErrorCode[];

export type CommandErrorCode = (typeof COMMAND_ERROR_CODES)[number];

export function commandError(
  code: CommandErrorCode,
  message: string,
  details?: Readonly<Record<string, string | number | boolean | null>>
): HttpsError {
  return new HttpsError(code, message, details);
}

export function errorCodeOf(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return "unknown";
}
