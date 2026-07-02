import { Redis } from '@upstash/redis';
import type { RedisLike } from './store';

let client: RedisLike | null = null;

export function getRedis(): RedisLike {
  if (!client) {
    // Reads UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN from the environment.
    client = Redis.fromEnv() as unknown as RedisLike;
  }
  return client;
}
