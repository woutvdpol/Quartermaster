/** Small in-memory LRU with a TTL (query embeddings, parsed shop dictionaries). Pure. */
export class TtlLru<V> {
  private map = new Map<string, { value: V; expires: number }>();
  constructor(
    private readonly max: number,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh recency.
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, { value, expires: this.now() + this.ttlMs });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
