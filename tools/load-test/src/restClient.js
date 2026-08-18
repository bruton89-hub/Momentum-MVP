"use strict";

/**
 * Minimal Firebase REST client for synthetic Momentum users.
 *
 * Why REST instead of the firebase JS SDK: one SDK app instance per virtual
 * user costs enough driver memory/CPU to distort measurements at hundreds of
 * VUs. The app under test issues only one-shot reads/writes/callables (no
 * snapshot listeners — verified in the Stage-1 audit), so REST requests with
 * a real Auth idToken produce the identical query shapes, the identical
 * security-rules evaluation, and identical billing characteristics, at a
 * fraction of driver overhead. Firestore security rules are fully enforced
 * for these requests — the harness never bypasses the app's security
 * controls (seeding/cleanup use the Admin SDK separately and are guarded).
 *
 * Every method mirrors a code path found in the repository; see the
 * `mirrors:` note on each.
 */

const DEFAULT_TIMEOUT_MS = 15_000;

class OpError extends Error {
  constructor(message, { code, status, timedOut = false } = {}) {
    super(message);
    this.name = "OpError";
    this.code = code;
    this.status = status;
    this.timedOut = timedOut;
  }
}

async function httpJson(url, { method = "POST", body, idToken, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!response.ok) {
      const message =
        json?.error?.message ||
        (Array.isArray(json) && json[0]?.error?.message) ||
        `HTTP ${response.status}`;
      const code =
        json?.error?.status ||
        (Array.isArray(json) && json[0]?.error?.status) ||
        String(response.status);
      throw new OpError(message, { code, status: response.status });
    }
    return json;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new OpError(`timeout after ${timeoutMs}ms: ${url}`, {
        code: "TIMEOUT",
        timedOut: true,
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Firestore value encoding ────────────────────────────────────────────────

function encodeValue(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (typeof value === "string") return { stringValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encodeValue) } };
  }
  if (value && typeof value === "object" && value.__ref) {
    return { referenceValue: value.__ref };
  }
  if (value && typeof value === "object") {
    return { mapValue: { fields: encodeFields(value) } };
  }
  throw new Error(`Cannot encode value: ${String(value)}`);
}

function encodeFields(object) {
  const fields = {};
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined) continue;
    fields[key] = encodeValue(value);
  }
  return fields;
}

function decodeValue(value) {
  if (value === null || value === undefined) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("timestampValue" in value) return new Date(value.timestampValue);
  if ("nullValue" in value) return null;
  if ("referenceValue" in value) return { __ref: value.referenceValue };
  if ("mapValue" in value) return decodeFields(value.mapValue.fields || {});
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeValue);
  return null;
}

function decodeFields(fields) {
  const out = {};
  for (const [key, value] of Object.entries(fields || {})) {
    out[key] = decodeValue(value);
  }
  return out;
}

function docIdFromName(name) {
  return name.split("/").pop();
}

// ─── Client ──────────────────────────────────────────────────────────────────

class MomentumRestClient {
  constructor(target) {
    this.target = target;
  }

  // mirrors: app/(auth)/register.tsx createUserWithEmailAndPassword
  async signUp(email, password) {
    const json = await httpJson(this.target.endpoints.authSignUp, {
      body: { email, password, returnSecureToken: true },
    });
    return { uid: json.localId, idToken: json.idToken };
  }

  // mirrors: app/(auth)/login.tsx signInWithEmailAndPassword
  async signIn(email, password) {
    const json = await httpJson(this.target.endpoints.authSignIn, {
      body: { email, password, returnSecureToken: true },
    });
    return { uid: json.localId, idToken: json.idToken };
  }

  async runQuery(idToken, structuredQuery) {
    const rows = await httpJson(this.target.endpoints.firestoreRunQuery, {
      idToken,
      body: { structuredQuery },
    });
    const docs = [];
    for (const row of rows || []) {
      if (row.document) {
        docs.push({
          id: docIdFromName(row.document.name),
          name: row.document.name,
          data: decodeFields(row.document.fields),
        });
      }
    }
    return docs;
  }

  async getDoc(idToken, collection, id) {
    try {
      const json = await httpJson(
        `${this.target.endpoints.firestoreDocs}/${collection}/${encodeURIComponent(id)}`,
        { method: "GET", idToken }
      );
      return { id, data: decodeFields(json.fields) };
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  async commit(idToken, writes) {
    return httpJson(this.target.endpoints.firestoreCommit, {
      idToken,
      body: { writes },
    });
  }

  writeSet(collection, id, data) {
    return {
      update: {
        name: this.target.documentPath(collection, id),
        fields: encodeFields(data),
      },
    };
  }

  writeCreate(collection, id, data) {
    return {
      ...this.writeSet(collection, id, data),
      currentDocument: { exists: false },
    };
  }

  writeUpdate(collection, id, data) {
    return {
      update: {
        name: this.target.documentPath(collection, id),
        fields: encodeFields(data),
      },
      updateMask: { fieldPaths: Object.keys(data) },
      currentDocument: { exists: true },
    };
  }

  writeDelete(collection, id) {
    return { delete: this.target.documentPath(collection, id) };
  }

  async countQuery(idToken, structuredQuery) {
    const rows = await httpJson(this.target.endpoints.firestoreRunAggregationQuery, {
      idToken,
      body: {
        structuredAggregationQuery: {
          structuredQuery,
          aggregations: [{ alias: "count", count: {} }],
        },
      },
    });
    const first = (rows || []).find((row) => row.result);
    return Number(first?.result?.aggregateFields?.count?.integerValue ?? 0);
  }

  async callable(name, idToken, data) {
    const json = await httpJson(this.target.endpoints.callable(name), {
      idToken,
      body: { data },
      timeoutMs: 30_000,
    });
    if (json?.error) {
      throw new OpError(json.error.message || "callable error", {
        code: json.error.status || json.error.message,
      });
    }
    return json?.result;
  }

  // ── Query builders that mirror the app's exact shapes ──────────────────────

  fieldFilter(fieldPath, op, value) {
    return { fieldFilter: { field: { fieldPath }, op, value: encodeValue(value) } };
  }

  // mirrors: hooks/usePosts.ts fetchPosts initial page
  feedFirstPageQuery(limit) {
    return {
      from: [{ collectionId: "posts" }],
      orderBy: [
        { field: { fieldPath: "createdAt" }, direction: "DESCENDING" },
        { field: { fieldPath: "__name__" }, direction: "DESCENDING" },
      ],
      limit,
    };
  }

  // mirrors: hooks/usePosts.ts background expansion (startAfter cursor)
  feedNextPageQuery(limit, cursorDoc) {
    return {
      ...this.feedFirstPageQuery(limit),
      startAt: {
        values: [
          encodeValue(cursorDoc.data.createdAt ?? new Date(0)),
          { referenceValue: cursorDoc.name },
        ],
        before: false,
      },
    };
  }

  // mirrors: hooks/usePosts.ts fetchLikedPostIds — documentId() `in` batches of 10
  likesByIdQuery(likeIds) {
    return {
      from: [{ collectionId: "likes" }],
      where: this.fieldFilter("__name__", "IN", likeIds.map((id) => ({
        __ref: this.target.documentPath("likes", id),
      }))),
    };
  }

  // mirrors: hooks/useBattles.ts fetchVotedBattleIds
  votesByIdQuery(voteIds) {
    return {
      from: [{ collectionId: "votes" }],
      where: this.fieldFilter("__name__", "IN", voteIds.map((id) => ({
        __ref: this.target.documentPath("votes", id),
      }))),
    };
  }

  // mirrors: services/postRepository.ts fetchPostsByUser (legacy 3-alias path)
  postsByAuthorFieldQuery(field, userId, limit) {
    return {
      from: [{ collectionId: "posts" }],
      where: this.fieldFilter(field, "EQUAL", userId),
      limit,
    };
  }

  // mirrors: services/postRepository.ts fetchPostsByUser (consolidated path)
  postsByUserOrderedQuery(userId, limit) {
    return {
      from: [{ collectionId: "posts" }],
      where: this.fieldFilter("userId", "EQUAL", userId),
      orderBy: [
        { field: { fieldPath: "createdAt" }, direction: "DESCENDING" },
        { field: { fieldPath: "__name__" }, direction: "DESCENDING" },
      ],
      limit,
    };
  }

  // mirrors: hooks/useBattles.ts battles page
  battlesPageQuery(limit) {
    return {
      from: [{ collectionId: "battles" }],
      orderBy: [
        { field: { fieldPath: "createdAt" }, direction: "DESCENDING" },
        { field: { fieldPath: "__name__" }, direction: "DESCENDING" },
      ],
      limit,
    };
  }

  // mirrors: services/notificationRepository.ts fetchNotificationsForUser
  notificationsQuery(uid, limit) {
    return {
      from: [{ collectionId: "notifications" }],
      where: this.fieldFilter("recipientId", "EQUAL", uid),
      limit,
    };
  }

  // mirrors: services/notificationRepository.ts fetchUnreadNotificationCount
  unreadCountQuery(uid) {
    return {
      from: [{ collectionId: "notifications" }],
      where: {
        compositeFilter: {
          op: "AND",
          filters: [
            this.fieldFilter("recipientId", "EQUAL", uid),
            this.fieldFilter("read", "EQUAL", false),
          ],
        },
      },
    };
  }

  // mirrors: hooks/useFollows.ts fetchFollowedIds
  followsQuery(uid) {
    return {
      from: [{ collectionId: "follows" }],
      where: this.fieldFilter("followerId", "EQUAL", uid),
    };
  }

  // mirrors: services/commentRepository.ts fetchCommentsForPost
  commentsQuery(postId, limit) {
    return {
      from: [{ collectionId: "comments" }],
      where: this.fieldFilter("postId", "EQUAL", postId),
      limit,
    };
  }
}

module.exports = {
  MomentumRestClient,
  OpError,
  encodeFields,
  decodeFields,
  encodeValue,
  decodeValue,
  DEFAULT_TIMEOUT_MS,
};
