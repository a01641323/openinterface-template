import { randomUUID } from 'node:crypto';
import type { AccessCode, AccessRequest } from './types';
import { computeExpiresAt, effectiveCodeStatus, generateCode } from './lifecycle';

// Minimal surface of @upstash/redis we use; FakeRedis implements it for tests.
// @upstash/redis auto-serializes objects on set and deserializes on get.
export interface RedisLike {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
}

const REQUESTS_INDEX = 'requests:index';
const CODES_INDEX = 'codes:index';
const requestKey = (id: string) => `request:${id}`;
const codeKey = (code: string) => `code:${code}`;
const linkKey = (requestId: string) => `request_code:${requestId}`;

// ---- requests ----

export async function createRequest(
  redis: RedisLike,
  name: string,
  cookieId: string,
): Promise<AccessRequest> {
  const request: AccessRequest = {
    id: randomUUID(),
    name,
    cookieId,
    status: 'pending',
    createdAt: Date.now(),
  };
  await redis.set(requestKey(request.id), request);
  await redis.sadd(REQUESTS_INDEX, request.id);
  return request;
}

export async function getRequest(redis: RedisLike, id: string): Promise<AccessRequest | null> {
  return redis.get<AccessRequest>(requestKey(id));
}

export async function listAllRequests(redis: RedisLike): Promise<AccessRequest[]> {
  const ids = await redis.smembers(REQUESTS_INDEX);
  const requests = await Promise.all(ids.map((id) => redis.get<AccessRequest>(requestKey(id))));
  return requests
    .filter((r): r is AccessRequest => r !== null)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function listRequestsByCookie(
  redis: RedisLike,
  cookieId: string,
): Promise<AccessRequest[]> {
  return (await listAllRequests(redis)).filter((r) => r.cookieId === cookieId);
}

export async function denyRequest(redis: RedisLike, id: string): Promise<AccessRequest | null> {
  const request = await getRequest(redis, id);
  if (!request || request.status !== 'pending') return null;
  const updated: AccessRequest = { ...request, status: 'denied' };
  await redis.set(requestKey(id), updated);
  return updated;
}

export async function deleteRequest(redis: RedisLike, id: string): Promise<void> {
  const code = await redis.get<string>(linkKey(id));
  if (code) {
    await redis.del(codeKey(code), linkKey(id));
    await redis.srem(CODES_INDEX, code);
  }
  await redis.del(requestKey(id));
  await redis.srem(REQUESTS_INDEX, id);
}

// ---- codes ----

export async function approveRequest(
  redis: RedisLike,
  requestId: string,
  timeoutMinutes: number,
  now: number = Date.now(),
): Promise<AccessCode | null> {
  const request = await getRequest(redis, requestId);
  if (!request || request.status !== 'pending') return null;
  const code: AccessCode = {
    code: generateCode(),
    requestId,
    name: request.name,
    timeoutMinutes,
    approvedAt: now,
    expiresAt: computeExpiresAt(now, timeoutMinutes),
    status: 'active',
  };
  await redis.set(requestKey(requestId), { ...request, status: 'approved' } satisfies AccessRequest);
  await redis.set(codeKey(code.code), code);
  await redis.sadd(CODES_INDEX, code.code);
  await redis.set(linkKey(requestId), code.code);
  return code;
}

export async function getCode(redis: RedisLike, code: string): Promise<AccessCode | null> {
  return redis.get<AccessCode>(codeKey(code));
}

export async function getCodeForRequest(
  redis: RedisLike,
  requestId: string,
): Promise<AccessCode | null> {
  const code = await redis.get<string>(linkKey(requestId));
  return code ? getCode(redis, code) : null;
}

export async function listAllCodes(redis: RedisLike): Promise<AccessCode[]> {
  const codes = await redis.smembers(CODES_INDEX);
  const records = await Promise.all(codes.map((c) => redis.get<AccessCode>(codeKey(c))));
  return records
    .filter((c): c is AccessCode => c !== null)
    .sort((a, b) => b.approvedAt - a.approvedAt);
}

export async function revokeCode(redis: RedisLike, code: string): Promise<AccessCode | null> {
  const record = await getCode(redis, code);
  if (!record) return null;
  const updated: AccessCode = { ...record, status: 'revoked' };
  await redis.set(codeKey(code), updated);
  return updated;
}

export async function deleteCode(redis: RedisLike, code: string): Promise<void> {
  const record = await getCode(redis, code);
  if (record) await redis.del(linkKey(record.requestId));
  await redis.del(codeKey(code));
  await redis.srem(CODES_INDEX, code);
}

// Lazy expiration: persist the active→expired transition the moment any read observes it.
export async function resolveCode(
  redis: RedisLike,
  code: AccessCode,
  now: number,
): Promise<AccessCode> {
  const status = effectiveCodeStatus(code, now);
  if (status === code.status) return code;
  const updated: AccessCode = { ...code, status };
  await redis.set(codeKey(code.code), updated);
  return updated;
}
