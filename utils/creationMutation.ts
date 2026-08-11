export interface CreationMutation {
  documentId: string;
  createdAtMs: number;
}

function randomPart(): string {
  return Math.random().toString(36).slice(2, 12);
}

/**
 * Allocate the Firestore identity before a write starts. Callers retain this
 * object until the logical operation succeeds or is deliberately discarded,
 * so retrying after a lost acknowledgement targets the same document.
 */
export function createCreationMutation(prefix: "post" | "battle"): CreationMutation {
  const createdAtMs = Date.now();
  return {
    documentId: `${prefix}_${createdAtMs.toString(36)}_${randomPart()}${randomPart()}`,
    createdAtMs,
  };
}
