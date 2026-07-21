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

export class TtlCache<K, V> {
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly pending = new Map<K, Promise<V>>();
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

    // Map insertion order is the recency list. Refreshing a hit makes eviction
    // deterministic LRU without an additional linked-list allocation.
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

  getOrSet(key: K, factory: () => Promise<V>): Promise<V> {
    const cachedValue = this.get(key);
    if (cachedValue !== undefined) {
      return Promise.resolve(cachedValue);
    }

    const pendingValue = this.pending.get(key);
    if (pendingValue !== undefined) {
      return pendingValue;
    }

    const valuePromise = factory()
      .then((value) => {
        this.set(key, value);
        return value;
      })
      .finally(() => {
        this.pending.delete(key);
      });

    this.pending.set(key, valuePromise);
    return valuePromise;
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
