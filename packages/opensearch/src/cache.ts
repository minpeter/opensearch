export class TtlCache<K, V> {
  private readonly store = new Map<K, { value: V; expiresAt: number }>();
  private readonly pending = new Map<K, Promise<V>>();
  private readonly ttlMs: number;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return;
    }
    if (Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return;
    }
    return entry.value;
  }

  set(key: K, value: V): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
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
}
