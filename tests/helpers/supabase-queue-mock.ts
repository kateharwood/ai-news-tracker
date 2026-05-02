/**
 * Minimal thenable PostgREST-style client for integration tests.
 * Each `await` on a chain consumes one entry from the queue (FIFO).
 */

export type QueuedSupabaseResult = {
  data?: unknown;
  error?: { message: string } | null;
  /** For head count selects */
  count?: number | null;
};

const state = { queue: [] as QueuedSupabaseResult[] };

export function seedSupabaseQueue(results: QueuedSupabaseResult[]) {
  state.queue = [...results];
}

export function assertSupabaseQueueEmpty() {
  if (state.queue.length > 0) {
    throw new Error(`Supabase mock: ${state.queue.length} unused queued result(s) remain`);
  }
}

function drain(): QueuedSupabaseResult {
  const r = state.queue.shift();
  if (!r) {
    throw new Error("Supabase mock: queue empty (unexpected await on database chain)");
  }
  return r;
}

function thenableResult(get: () => QueuedSupabaseResult) {
  return {
    then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
      const r = get();
      const payload = {
        data: r.data ?? null,
        error: r.error ?? null,
        count: r.count !== undefined ? r.count : null,
      };
      return Promise.resolve(payload).then(onFulfilled, onRejected);
    },
  };
}

function chainSelectHeadCount() {
  const terminal = thenableResult(drain);
  const self = {
    is: () => self,
    lt: () => self,
    ...terminal,
  };
  return self;
}

function chainSelect() {
  const terminal = thenableResult(drain);
  const self = {
    eq: () => self,
    is: () => self,
    lt: () => self,
    gte: () => self,
    order: () => self,
    maybeSingle: () => self,
    single: () => self,
    ...terminal,
  };
  return self;
}

function chainUpdate() {
  const terminal = thenableResult(drain);
  const self = {
    eq: () => self,
    is: () => self,
    lt: () => self,
    ...terminal,
  };
  return self;
}

function chainDelete() {
  const terminal = thenableResult(drain);
  const self = {
    eq: () => self,
    ...terminal,
  };
  return self;
}

function chainInsert() {
  return Object.assign(
    {
      select() {
        return {
          single() {
            return thenableResult(drain);
          },
        };
      },
    },
    thenableResult(drain)
  );
}

export function createQueueSupabaseClient() {
  return {
    from(_table: string) {
      return {
        select(_cols?: string, opts?: { count?: string; head?: boolean }) {
          if (opts?.head && opts?.count === "exact") {
            return chainSelectHeadCount();
          }
          return chainSelect();
        },
        update(_payload?: unknown) {
          return chainUpdate();
        },
        insert(_payload?: unknown) {
          return chainInsert();
        },
        upsert(_payload?: unknown, _opts?: unknown) {
          return thenableResult(drain);
        },
        delete() {
          return chainDelete();
        },
      };
    },
  };
}
