import type { RedisLike } from '../lib/store';

export class FakeRedis implements RedisLike {
  private data = new Map<string, unknown>();
  private sets = new Map<string, Set<string>>();

  async get<T>(key: string): Promise<T | null> {
    return (this.data.get(key) as T) ?? null;
  }
  async set(key: string, value: unknown): Promise<unknown> {
    this.data.set(key, value);
    return 'OK';
  }
  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) {
      if (this.data.delete(k)) n++;
      if (this.sets.delete(k)) n++;
    }
    return n;
  }
  async sadd(key: string, ...members: string[]): Promise<number> {
    const s = this.sets.get(key) ?? new Set<string>();
    for (const m of members) s.add(m);
    this.sets.set(key, s);
    return members.length;
  }
  async srem(key: string, ...members: string[]): Promise<number> {
    const s = this.sets.get(key);
    if (!s) return 0;
    let n = 0;
    for (const m of members) if (s.delete(m)) n++;
    return n;
  }
  async smembers(key: string): Promise<string[]> {
    return [...(this.sets.get(key) ?? [])];
  }
}
