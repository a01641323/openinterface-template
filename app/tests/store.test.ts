import { describe, it, expect } from 'vitest';
import { FakeRedis } from './fake-redis';
import {
  createRequest, getRequest, listRequestsByCookie, listAllRequests, deleteRequest,
  approveRequest, denyRequest, getCode, getCodeForRequest, listAllCodes,
  revokeCode, deleteCode, resolveCode,
} from '../lib/store';

const NOW = 1_700_000_000_000;

describe('requests', () => {
  it('createRequest stores a pending request retrievable by id and cookie', async () => {
    const redis = new FakeRedis();
    const req = await createRequest(redis, 'Alice', 'cookie-a');
    expect(req.status).toBe('pending');
    expect(req.name).toBe('Alice');
    expect(await getRequest(redis, req.id)).toEqual(req);
    expect(await listRequestsByCookie(redis, 'cookie-a')).toEqual([req]);
    expect(await listRequestsByCookie(redis, 'cookie-b')).toEqual([]);
  });

  it('listAllRequests returns every request, newest first', async () => {
    const redis = new FakeRedis();
    const a = await createRequest(redis, 'A', 'c1');
    const b = await createRequest(redis, 'B', 'c2');
    // force distinct createdAt ordering
    await redis.set(`request:${a.id}`, { ...a, createdAt: 1 });
    await redis.set(`request:${b.id}`, { ...b, createdAt: 2 });
    const all = await listAllRequests(redis);
    expect(all.map((r) => r.name)).toEqual(['B', 'A']);
  });

  it('denyRequest marks pending request denied; refuses non-pending', async () => {
    const redis = new FakeRedis();
    const req = await createRequest(redis, 'Alice', 'c');
    const denied = await denyRequest(redis, req.id);
    expect(denied?.status).toBe('denied');
    expect(await denyRequest(redis, req.id)).toBeNull(); // already denied
    expect(await denyRequest(redis, 'nope')).toBeNull();
  });
});

describe('approve → code', () => {
  it('approveRequest creates an active code and marks the request approved', async () => {
    const redis = new FakeRedis();
    const req = await createRequest(redis, 'Alice', 'c');
    const code = await approveRequest(redis, req.id, 30, NOW);
    expect(code).not.toBeNull();
    expect(code!.status).toBe('active');
    expect(code!.name).toBe('Alice');
    expect(code!.approvedAt).toBe(NOW);
    expect(code!.expiresAt).toBe(NOW + 30 * 60_000);
    expect(code!.code).toMatch(/^[A-Z2-9]{8}$/);
    expect((await getRequest(redis, req.id))!.status).toBe('approved');
    expect(await getCode(redis, code!.code)).toEqual(code);
    expect(await getCodeForRequest(redis, req.id)).toEqual(code);
    expect(await listAllCodes(redis)).toEqual([code]);
  });

  it('approveRequest refuses non-pending requests', async () => {
    const redis = new FakeRedis();
    const req = await createRequest(redis, 'Alice', 'c');
    await approveRequest(redis, req.id, 30, NOW);
    expect(await approveRequest(redis, req.id, 30, NOW)).toBeNull();
    expect(await approveRequest(redis, 'missing', 30, NOW)).toBeNull();
  });
});

describe('code lifecycle in storage', () => {
  async function activeCode(redis: FakeRedis) {
    const req = await createRequest(redis, 'Alice', 'c');
    return (await approveRequest(redis, req.id, 30, NOW))!;
  }

  it('revokeCode marks a code revoked', async () => {
    const redis = new FakeRedis();
    const code = await activeCode(redis);
    const revoked = await revokeCode(redis, code.code);
    expect(revoked?.status).toBe('revoked');
    expect((await getCode(redis, code.code))!.status).toBe('revoked');
    expect(await revokeCode(redis, 'MISSING1')).toBeNull();
  });

  it('resolveCode lazily persists expiry when past expiresAt', async () => {
    const redis = new FakeRedis();
    const code = await activeCode(redis);
    const resolved = await resolveCode(redis, code, code.expiresAt + 1);
    expect(resolved.status).toBe('expired');
    expect((await getCode(redis, code.code))!.status).toBe('expired'); // persisted
  });

  it('resolveCode leaves active codes untouched before expiry', async () => {
    const redis = new FakeRedis();
    const code = await activeCode(redis);
    const resolved = await resolveCode(redis, code, code.expiresAt - 1);
    expect(resolved.status).toBe('active');
  });
});

describe('deletion', () => {
  it('deleteRequest cascades to the linked code', async () => {
    const redis = new FakeRedis();
    const req = await createRequest(redis, 'Alice', 'c');
    const code = (await approveRequest(redis, req.id, 30, NOW))!;
    await deleteRequest(redis, req.id);
    expect(await getRequest(redis, req.id)).toBeNull();
    expect(await getCode(redis, code.code)).toBeNull();
    expect(await listAllCodes(redis)).toEqual([]);
    expect(await listAllRequests(redis)).toEqual([]);
  });

  it('deleteCode removes the code and its request link', async () => {
    const redis = new FakeRedis();
    const req = await createRequest(redis, 'Alice', 'c');
    const code = (await approveRequest(redis, req.id, 30, NOW))!;
    await deleteCode(redis, code.code);
    expect(await getCode(redis, code.code)).toBeNull();
    expect(await getCodeForRequest(redis, req.id)).toBeNull();
    expect(await getRequest(redis, req.id)).not.toBeNull(); // request survives
  });
});
