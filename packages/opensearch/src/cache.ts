const DEFAULT_MAX_ENTRIES = 256;

export interface CacheOptions {
  readonly enabled?: boolean;
  readonly maxEntries?: number;
  readonly ttlMs?: number;
}

interface TtlCacheOptions {
  readonly maxEntries?: number;
  readonly now?: () => number;
}

export interface Pending<V> {
  readonly controller: AbortController;
  readonly promise: Promise<V>;
  readonly waiters: Set<CacheWaiter>;
}

export interface CacheWaiter {
  readonly abort: () => void;
  readonly pending: Set<Pending<unknown>>;
  readonly signal?: AbortSignal;
}

export class TtlCache<K, V> {
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly pending = new Map<K, Pending<V>>();
  private readonly store = new Map<K, { value: V; expiresAt: number }>();
  private readonly ttlMs: number;

  constructor(ttlMs: number, options: TtlCacheOptions = {}) {
    this.ttlMs = requirePositiveSafeInteger(ttlMs, "ttlMs");
    this.maxEntries = requirePositiveSafeInteger(
      options.maxEntries ?? DEFAULT_MAX_ENTRIES,
      "maxEntries"
    );
    this.now = options.now ?? (() => Date.now());
  }

  get size(): number {
    this.deleteExpired(this.now());
    return this.store.size;
  }

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return;
    }
    if (this.now() >= entry.expiresAt) {
      this.store.delete(key);
      return;
    }
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    const now = this.now();
    this.store.delete(key);
    if (this.store.size >= this.maxEntries) {
      this.deleteExpired(now);
    }
    while (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next();
      if (oldest.done) {
        break;
      }
      this.store.delete(oldest.value);
    }
    this.store.set(key, { expiresAt: now + this.ttlMs, value });
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  createWaiter(signal?: AbortSignal): CacheWaiter {
    const pending = new Set<Pending<unknown>>();
    const waiter: CacheWaiter = {
      abort: () => {
        for (const entry of pending) {
          entry.waiters.delete(waiter);
          if (entry.waiters.size === 0) {
            entry.controller.abort(signal?.reason);
          }
        }
        pending.clear();
      },
      pending,
      signal,
    };
    if (signal) {
      if (signal.aborted) {
        waiter.abort();
      } else {
        signal.addEventListener("abort", waiter.abort, { once: true });
      }
    }
    return waiter;
  }

  releaseWaiter(waiter: CacheWaiter): void {
    waiter.abort();
    waiter.signal?.removeEventListener("abort", waiter.abort);
  }

  getOrSet(
    key: K,
    factory: (signal: AbortSignal) => Promise<V>,
    waiter?: CacheWaiter
  ): Promise<V> {
    const cachedValue = this.get(key);
    if (cachedValue !== undefined) {
      return Promise.resolve(cachedValue);
    }

    let entry = this.pending.get(key);
    if (!entry) {
      const controller = new AbortController();
      const waiters = new Set<CacheWaiter>();
      const promise = factory(controller.signal).then((value) => {
        if (!controller.signal.aborted) {
          this.set(key, value);
        }
        return value;
      });
      entry = { controller, promise, waiters };
      this.pending.set(key, entry);
      promise.then(
        () => {
          if (this.pending.get(key) === entry) {
            this.pending.delete(key);
          }
        },
        () => {
          if (this.pending.get(key) === entry) {
            this.pending.delete(key);
          }
        }
      );
    }

    if (waiter) {
      entry.waiters.add(waiter);
      waiter.pending.add(entry);
    }
    return entry.promise;
  }

  private deleteExpired(now: number): void {
    for (const [key, entry] of this.store) {
      if (now >= entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}

export function resolveCacheOptions(
  options: CacheOptions | undefined,
  defaults: { readonly maxEntries: number; readonly ttlMs: number }
): {
  readonly enabled: boolean;
  readonly maxEntries: number;
  readonly ttlMs: number;
} {
  return {
    enabled: options?.enabled ?? true,
    maxEntries: requirePositiveSafeInteger(
      options?.maxEntries ?? defaults.maxEntries,
      "cache.maxEntries"
    ),
    ttlMs: requirePositiveSafeInteger(
      options?.ttlMs ?? defaults.ttlMs,
      "cache.ttlMs"
    ),
  };
}

function requirePositiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}
