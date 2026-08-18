"use strict";

/**
 * Synthetic Momentum user workloads.
 *
 * Each behavior mirrors a real client code path (noted inline). Client-side
 * pagination in the app windows an already-fetched pool (usePosts
 * DISCOVERY_PAGE_SIZE) — it costs think time, not Firestore reads — so it is
 * modeled as think time here too.
 *
 * Page sizes are the app's real constants:
 *   feed initial 24, feed background 56 (usePosts.ts)
 *   battles page 30 (useBattles.ts), profile posts 30/alias (postRepository.ts)
 *   notifications fetch 100 (notificationRepository.ts)
 */

const FEED_INITIAL = 24;
const FEED_BACKGROUND = 56;
const BATTLES_PAGE = 30;
const PROFILE_POST_LIMIT = 30;
const NOTIFICATIONS_LIMIT = 100;
const IN_BATCH = 10;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

class VirtualUser {
  /**
   * @param {object} options
   * @param {MomentumRestClient} options.client
   * @param {Metrics} options.metrics
   * @param {{uid:string,email:string,password:string,username:string}} options.identity
   * @param {object} options.world  seeded ids {postIds, battleIds, hotBattleId, userIds}
   * @param {number} options.seed
   * @param {{consolidatedPosts?:boolean, thinkScale?:number}} options.options
   */
  constructor({ client, metrics, identity, world, seed, bucket, options = {} }) {
    this.client = client;
    // Storage bucket for synthetic media URLs. Rules validate the
    // posts/{uid}/ path segment, but the URL should still be well-formed.
    this.bucket = bucket ?? "demo-momentum-loadtest.appspot.com";
    this.metrics = metrics;
    this.identity = identity;
    this.world = world;
    this.rng = mulberry32(seed);
    this.idToken = null;
    this.uid = identity.uid;
    this.consolidatedPosts = options.consolidatedPosts === true;
    this.thinkScale = options.thinkScale ?? 1;
    this.stopped = false;
    this.feedPool = [];
    this.createdPostIds = [];
    this.sessionCounter = 0;
  }

  stop() {
    this.stopped = true;
  }

  async think(minMs, maxMs) {
    const ms = (minMs + this.rng() * (maxMs - minMs)) * this.thinkScale;
    const step = 250;
    let waited = 0;
    while (waited < ms && !this.stopped) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(step, ms - waited)));
      waited += step;
    }
  }

  pick(array) {
    return array[Math.floor(this.rng() * array.length)];
  }

  // ── Primitive operations (each = one measured user-facing op) ──────────────

  // mirrors: app/(auth)/login.tsx
  async authenticate() {
    const result = await this.metrics.record("auth.signIn", () =>
      this.client.signIn(this.identity.email, this.identity.password)
    );
    this.idToken = result.idToken;
    return result;
  }

  // mirrors: hooks/usePosts.ts fetchPosts — initial page + likes hydration +
  // background expansion + background likes
  async loadFeed() {
    const first = await this.metrics.record(
      "feed.firstPage",
      () => this.client.runQuery(this.idToken, this.client.feedFirstPageQuery(FEED_INITIAL)),
      { readsFromResult: (docs) => docs.length }
    );
    this.feedPool = first;

    if (first.length > 0) {
      const likeIds = first.map((post) => `${post.id}_${this.uid}`);
      await Promise.all(
        chunk(likeIds, IN_BATCH).map((ids) =>
          this.metrics.record(
            "feed.likesHydration",
            () => this.client.runQuery(this.idToken, this.client.likesByIdQuery(ids)),
            { readsFromResult: (docs) => Math.max(1, docs.length) }
          ).catch(() => [])
        )
      );
    }

    if (first.length === FEED_INITIAL) {
      const background = await this.metrics.record(
        "feed.backgroundPage",
        () =>
          this.client.runQuery(
            this.idToken,
            this.client.feedNextPageQuery(FEED_BACKGROUND, first[first.length - 1])
          ),
        { readsFromResult: (docs) => docs.length }
      ).catch(() => []);
      this.feedPool = [...first, ...background];
      if (background.length > 0) {
        const likeIds = background.map((post) => `${post.id}_${this.uid}`);
        await Promise.all(
          chunk(likeIds, IN_BATCH).map((ids) =>
            this.metrics.record(
              "feed.likesHydration",
              () => this.client.runQuery(this.idToken, this.client.likesByIdQuery(ids)),
              { readsFromResult: (docs) => Math.max(1, docs.length) }
            ).catch(() => [])
          )
        );
      }
    }
    return this.feedPool;
  }

  // mirrors: hooks/useFollows.ts fetchFollowedIds (runs alongside the feed)
  async loadFollows() {
    return this.metrics.record(
      "social.followsLoad",
      () => this.client.runQuery(this.idToken, this.client.followsQuery(this.uid)),
      { readsFromResult: (docs) => Math.max(1, docs.length) }
    );
  }

  // mirrors: services/notificationRepository.ts fetchUnreadNotificationCount
  async pollUnreadBadge() {
    return this.metrics.record(
      "notifications.unreadCount",
      () => this.client.countQuery(this.idToken, this.client.unreadCountQuery(this.uid)),
      { reads: 1 }
    );
  }

  // mirrors: hooks/useProfile.ts fetchUserProfile + services/postRepository.ts
  // fetchPostsByUser (legacy 3-alias fan-out by default, matching .env)
  async openProfile(userId) {
    await this.metrics.record(
      "profile.userDoc",
      () => this.client.getDoc(this.idToken, "users", userId),
      { reads: 1 }
    );
    if (this.consolidatedPosts) {
      await this.metrics.record(
        "profile.posts",
        () =>
          this.client.runQuery(
            this.idToken,
            this.client.postsByUserOrderedQuery(userId, PROFILE_POST_LIMIT)
          ),
        { readsFromResult: (docs) => Math.max(1, docs.length) }
      );
    } else {
      await Promise.all(
        ["userId", "authorId", "uid"].map((field) =>
          this.metrics.record(
            "profile.posts",
            () =>
              this.client.runQuery(
                this.idToken,
                this.client.postsByAuthorFieldQuery(field, userId, PROFILE_POST_LIMIT)
              ),
            { readsFromResult: (docs) => Math.max(1, docs.length) }
          )
        )
      );
    }
  }

  // mirrors: hooks/useBattles.ts fetchBattlePage + fetchVotedBattleIds
  async openBattlesTab({ includeVotes = true } = {}) {
    const battles = await this.metrics.record(
      "battles.page",
      () => this.client.runQuery(this.idToken, this.client.battlesPageQuery(BATTLES_PAGE)),
      { readsFromResult: (docs) => Math.max(1, docs.length) }
    );
    if (includeVotes && battles.length > 0) {
      const voteIds = battles.map((battle) => `${battle.id}_${this.uid}`);
      await Promise.all(
        chunk(voteIds, IN_BATCH).map((ids) =>
          this.metrics.record(
            "battles.votesHydration",
            () => this.client.runQuery(this.idToken, this.client.votesByIdQuery(ids)),
            { readsFromResult: (docs) => Math.max(1, docs.length) }
          ).catch(() => [])
        )
      );
    }
    return battles;
  }

  // mirrors: app/notifications.tsx via fetchNotificationsForUser
  async openNotifications() {
    return this.metrics.record(
      "notifications.list",
      () =>
        this.client.runQuery(
          this.idToken,
          this.client.notificationsQuery(this.uid, NOTIFICATIONS_LIMIT)
        ),
      { readsFromResult: (docs) => Math.max(1, docs.length) }
    );
  }

  // mirrors: services/commentRepository.ts fetchCommentsForPost
  async openComments(postId) {
    return this.metrics.record(
      "comments.list",
      () => this.client.runQuery(this.idToken, this.client.commentsQuery(postId, 100)),
      { readsFromResult: (docs) => Math.max(1, docs.length) }
    );
  }

  // mirrors: hooks/usePosts.ts handleLike → setPostLike callable
  async like(postId, liked) {
    return this.metrics.record(
      "engagement.like",
      () =>
        this.client.callable("setPostLike", this.idToken, {
          postId,
          liked,
          clientMutationId: `${postId}:${this.uid}:${liked}`,
        }),
      { functionCalls: 1, reads: 2, writes: 2 }
    );
  }

  // mirrors: hooks/useBattles.ts submitVote → castBattleVote callable
  async vote(battleId, side) {
    return this.metrics.record(
      "engagement.vote",
      () =>
        this.client.callable("castBattleVote", this.idToken, {
          battleId,
          side,
          clientMutationId: `${battleId}:${this.uid}`,
        }),
      { functionCalls: 1, reads: 2, writes: 2 }
    );
  }

  // mirrors: hooks/useFollows.ts follow + notifyFollow
  async follow(targetUserId) {
    const followId = `${this.uid}_${targetUserId}`;
    await this.metrics.record(
      "social.follow",
      () =>
        this.client.commit(this.idToken, [
          this.client.writeSet("follows", followId, {
            followerId: this.uid,
            followingId: targetUserId,
            createdAt: new Date(),
          }),
        ]),
      { writes: 1 }
    );
    // Fire-and-forget follow notification (deterministic id, rules-validated).
    await this.metrics.record(
      "social.followNotification",
      () =>
        this.client.commit(this.idToken, [
          this.client.writeSet("notifications", `follow_${followId}`, {
            type: "follow",
            recipientId: targetUserId,
            actorId: this.uid,
            subjectUsername: this.identity.username,
            subjectAvatar: "",
            read: false,
            createdAt: new Date(),
          }),
        ]),
      { writes: 1, reads: 2 }
    ).catch(() => undefined);
  }

  // mirrors: hooks/useFollows.ts unfollow
  async unfollow(targetUserId) {
    return this.metrics.record(
      "social.unfollow",
      () =>
        this.client.commit(this.idToken, [
          this.client.writeDelete("follows", `${this.uid}_${targetUserId}`),
        ]),
      { writes: 1 }
    );
  }

  // mirrors: hooks/usePosts.ts createPost — metadata only (no media bytes in
  // the main benchmark), exact field set the client writes.
  async createPost() {
    const id = `lt-post-${this.uid}-${this.sessionCounter++}-${Math.floor(this.rng() * 1e9).toString(36)}`;
    const now = new Date();
    const mediaUrl =
      `https://firebasestorage.googleapis.com/v0/b/${this.bucket}` +
      `/o/posts%2F${this.uid}%2F${id}.mp4?alt=media&token=lt`;
    await this.metrics.record(
      "creation.post",
      () =>
        this.client.commit(this.idToken, [
          this.client.writeSet("posts", id, {
            userId: this.uid,
            username: this.identity.username,
            userAvatar: "",
            avatarUrl: "",
            mediaUrl,
            mediaType: "video",
            caption: "synthetic load-test highlight",
            battleEnabled: true,
            authorId: this.uid,
            uid: this.uid,
            authorAvatar: "",
            likesCount: 0,
            createdAt: now,
            updatedAt: now,
          }),
        ]),
      { writes: 1, reads: 1 }
    );
    this.createdPostIds.push(id);
    return id;
  }

  // mirrors: hooks/useBattles.ts createBattle (open challenge)
  async createOpenBattle(postId) {
    const id = `lt-battle-${this.uid}-${this.sessionCounter++}-${Math.floor(this.rng() * 1e9).toString(36)}`;
    const now = new Date();
    const post = await this.client.getDoc(this.idToken, "posts", postId);
    if (!post) throw new Error(`backing post ${postId} missing`);
    await this.metrics.record(
      "creation.battle",
      () =>
        this.client.commit(this.idToken, [
          this.client.writeSet("battles", id, {
            creatorId: this.uid,
            playerA: {
              userId: this.uid,
              username: post.data.username ?? this.identity.username,
              avatar: "",
              mediaUrl: post.data.mediaUrl,
              mediaType: post.data.mediaType ?? "video",
              postId,
            },
            playerB: null,
            votesA: 0,
            votesB: 0,
            status: "open",
            category: "Highlights",
            durationHours: 24,
            endTime: new Date(now.getTime() + 24 * 3_600_000),
            winner: null,
            statsRecorded: false,
            createdAt: now,
          }),
        ]),
      { writes: 1, reads: 2 }
    );
    return id;
  }
}

// ─── Workload session loops ──────────────────────────────────────────────────

/** Workload A — Browsing athlete. */
async function browsingSession(vu) {
  await vu.authenticate();
  while (!vu.stopped) {
    await Promise.all([vu.loadFeed(), vu.loadFollows()]);
    await vu.pollUnreadBadge().catch(() => 0);
    // Scroll/paginate: client-side windowing over the fetched pool.
    const scrolls = 3 + Math.floor(vu.rng() * 6);
    for (let index = 0; index < scrolls && !vu.stopped; index += 1) {
      await vu.think(1_500, 5_000);
    }
    // Open a few athlete profiles / posts.
    const profileOpens = 1 + Math.floor(vu.rng() * 3);
    for (let index = 0; index < profileOpens && !vu.stopped; index += 1) {
      const target = vu.pick(vu.world.userIds);
      await vu.openProfile(target).catch(() => undefined);
      if (vu.rng() < 0.4 && vu.feedPool.length > 0) {
        await vu.openComments(vu.pick(vu.feedPool).id).catch(() => undefined);
      }
      await vu.think(3_000, 8_000);
    }
    // Periodic refresh cadence before the next feed pass.
    await vu.think(8_000, 20_000);
  }
}

/** Workload B — Engaged athlete. */
async function engagedSession(vu) {
  await vu.authenticate();
  while (!vu.stopped) {
    await Promise.all([vu.loadFeed(), vu.loadFollows()]);
    await vu.pollUnreadBadge().catch(() => 0);
    const likes = 2 + Math.floor(vu.rng() * 4);
    for (let index = 0; index < likes && !vu.stopped; index += 1) {
      const post = vu.feedPool.length ? vu.pick(vu.feedPool) : null;
      if (post) await vu.like(post.id, true).catch(() => undefined);
      await vu.think(1_000, 3_000);
    }
    if (!vu.stopped && vu.rng() < 0.5) {
      const target = vu.pick(vu.world.userIds.filter((id) => id !== vu.uid));
      if (target) {
        await vu.follow(target).catch(() => undefined);
        await vu.think(500, 1_500);
        if (vu.rng() < 0.3) await vu.unfollow(target).catch(() => undefined);
      }
    }
    if (!vu.stopped) {
      const target = vu.pick(vu.world.userIds);
      await vu.openProfile(target).catch(() => undefined);
    }
    if (!vu.stopped) {
      const battles = await vu.openBattlesTab().catch(() => []);
      const votable = battles.filter(
        (battle) =>
          battle.data.status === "live" &&
          battle.data.playerA?.userId !== vu.uid &&
          battle.data.playerB?.userId !== vu.uid
      );
      const votes = Math.min(votable.length, 1 + Math.floor(vu.rng() * 2));
      for (let index = 0; index < votes && !vu.stopped; index += 1) {
        const battle = votable[index];
        await vu
          .vote(battle.id, vu.rng() < 0.5 ? "A" : "B")
          .catch(() => undefined);
        await vu.think(1_000, 2_500);
      }
    }
    await vu.think(6_000, 15_000);
  }
}

/** Workload C — Creator. */
async function creatorSession(vu) {
  await vu.authenticate();
  while (!vu.stopped) {
    await Promise.all([vu.loadFeed(), vu.loadFollows()]);
    const postId = await vu.createPost().catch(() => null);
    if (postId && vu.rng() < 0.4) {
      await vu.createOpenBattle(postId).catch(() => undefined);
    }
    // Review own profile after publishing.
    await vu.openProfile(vu.uid).catch(() => undefined);
    await vu.pollUnreadBadge().catch(() => 0);
    await vu.openNotifications().catch(() => undefined);
    // Creators publish occasionally, not continuously.
    await vu.think(20_000, 60_000);
  }
}

/** Workload D — Battle-focused user hammering the hot battle. */
async function battleSession(vu) {
  await vu.authenticate();
  let voted = false;
  while (!vu.stopped) {
    await vu.openBattlesTab().catch(() => []);
    if (!voted && vu.world.hotBattleId) {
      const outcome = await vu
        .vote(vu.world.hotBattleId, vu.rng() < 0.5 ? "A" : "B")
        .catch(() => null);
      voted = outcome !== null;
    }
    // Battle watchers keep refreshing the page to watch totals move.
    await vu.think(3_000, 8_000);
  }
}

const WORKLOADS = {
  browsing: browsingSession,
  engaged: engagedSession,
  creator: creatorSession,
  battle: battleSession,
};

/** Mixed population split (Workload E). Documented in the README. */
const DEFAULT_MIX = Object.freeze({
  browsing: 0.6,
  engaged: 0.25,
  creator: 0.1,
  battle: 0.05,
});

function workloadForIndex(index, total, mix = DEFAULT_MIX) {
  const boundaries = [];
  let cumulative = 0;
  for (const [name, share] of Object.entries(mix)) {
    cumulative += share;
    boundaries.push([name, cumulative]);
  }
  const position = total <= 1 ? 0 : index / total;
  for (const [name, boundary] of boundaries) {
    if (position < boundary) return name;
  }
  return boundaries[boundaries.length - 1][0];
}

module.exports = {
  VirtualUser,
  WORKLOADS,
  DEFAULT_MIX,
  workloadForIndex,
  FEED_INITIAL,
  FEED_BACKGROUND,
  BATTLES_PAGE,
  PROFILE_POST_LIMIT,
};
