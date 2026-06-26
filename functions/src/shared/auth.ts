import { HttpsError } from "firebase-functions/v2/https";

export interface CallableAuth {
  uid?: unknown;
}

export function requireAuthenticatedUid(
  auth: CallableAuth | null | undefined
): string {
  const uid = auth?.uid;
  if (typeof uid !== "string" || uid.trim().length === 0) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }
  return uid;
}
