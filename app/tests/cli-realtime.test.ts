import { describe, it, expect } from 'vitest';
import { createRealtime, PALETTE } from '../../cli/lib/realtime.mjs';

type Msg = Record<string, unknown>;

class StubConn {
  sent: Msg[] = [];
  closed = false;
  private handlers: Record<string, Array<(...args: unknown[]) => void>> = { message: [], close: [] };

  send(m: Msg) {
    this.sent.push(m);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }
  on(ev: string, fn: (...args: unknown[]) => void) {
    this.handlers[ev].push(fn);
  }
  emit(ev: string, ...args: unknown[]) {
    for (const fn of [...this.handlers[ev]]) fn(...args);
  }
  last(type: string): Msg | undefined {
    return [...this.sent].reverse().find((m) => m.type === type);
  }
}

function setup() {
  const rt = createRealtime();
  const host = new StubConn();
  rt.addHost(host);
  return { rt, host };
}

function joinGuest(rt: ReturnType<typeof createRealtime>, ip = '192.168.1.50') {
  const guest = new StubConn();
  rt.addGuest(guest, ip);
  return guest;
}

describe('realtime state machine', () => {
  it('host hello carries colors and empty pending list', () => {
    const { host } = setup();
    expect(host.sent[0]).toEqual({ type: 'hello', role: 'host', colors: [0, 0, 0], pending: [] });
  });

  it('guest join: guest goes pending, host gets joinRequest with ip', () => {
    const { rt, host } = setup();
    const guest = joinGuest(rt, '192.168.1.50');
    expect(guest.sent[0]).toEqual({ type: 'hello', role: 'guest', state: 'pending' });
    expect(host.last('joinRequest')).toMatchObject({ ip: '192.168.1.50' });
  });

  it('approve: guest receives approved with current colors, then broadcasts', () => {
    const { rt, host } = setup();
    const guest = joinGuest(rt);
    const id = host.last('joinRequest')!.id as number;
    host.emit('message', { type: 'approve', id });
    expect(guest.last('approved')).toEqual({ type: 'approved', colors: [0, 0, 0] });
    guest.emit('message', { type: 'cycle', button: 1 });
    expect(host.last('colors')).toEqual({ type: 'colors', colors: [0, 1, 0] });
    expect(guest.last('colors')).toEqual({ type: 'colors', colors: [0, 1, 0] });
  });

  it('cycle wraps around the palette', () => {
    const { host } = setup();
    for (let i = 0; i < PALETTE.length; i++) host.emit('message', { type: 'cycle', button: 0 });
    expect(host.last('colors')).toEqual({ type: 'colors', colors: [0, 0, 0] });
  });

  it('cycle from a pending guest is ignored', () => {
    const { rt, host } = setup();
    const guest = joinGuest(rt);
    guest.emit('message', { type: 'cycle', button: 0 });
    expect(host.last('colors')).toBeUndefined();
  });

  it('pending guests do not receive color broadcasts', () => {
    const { rt, host } = setup();
    const guest = joinGuest(rt);
    host.emit('message', { type: 'cycle', button: 2 });
    expect(guest.last('colors')).toBeUndefined();
  });

  it('deny: guest told once, closed, removed without guestLeft echo', () => {
    const { rt, host } = setup();
    const guest = joinGuest(rt);
    const id = host.last('joinRequest')!.id as number;
    host.emit('message', { type: 'deny', id });
    expect(guest.last('denied')).toEqual({ type: 'denied' });
    expect(guest.closed).toBe(true);
    expect(host.last('guestLeft')).toBeUndefined();
    // approving after deny does nothing
    host.emit('message', { type: 'approve', id });
    expect(guest.last('approved')).toBeUndefined();
  });

  it('guest disconnect notifies host with guestLeft', () => {
    const { rt, host } = setup();
    const guest = joinGuest(rt);
    const id = host.last('joinRequest')!.id as number;
    guest.close();
    expect(host.last('guestLeft')).toEqual({ type: 'guestLeft', id });
  });

  it('endSession: everyone told, guests closed, colors reset', () => {
    const { rt, host } = setup();
    const guest = joinGuest(rt);
    host.emit('message', { type: 'approve', id: host.last('joinRequest')!.id });
    host.emit('message', { type: 'cycle', button: 0 });
    rt.endSession();
    expect(host.last('sessionEnded')).toEqual({ type: 'sessionEnded' });
    expect(guest.last('sessionEnded')).toEqual({ type: 'sessionEnded' });
    expect(guest.closed).toBe(true);
    // a host reconnecting sees reset state
    const lateHost = new StubConn();
    rt.addHost(lateHost);
    expect(lateHost.sent[0]).toMatchObject({ colors: [0, 0, 0], pending: [] });
  });

  it('a host connecting late gets pending guests replayed', () => {
    const rt = createRealtime();
    joinGuest(rt, '10.0.0.7');
    const host = new StubConn();
    rt.addHost(host);
    expect(host.sent[0].pending).toEqual([{ id: 1, ip: '10.0.0.7' }]);
  });

  it('startSession resets colors', () => {
    const { rt, host } = setup();
    host.emit('message', { type: 'cycle', button: 0 });
    rt.startSession();
    const lateHost = new StubConn();
    rt.addHost(lateHost);
    expect(lateHost.sent[0]).toMatchObject({ colors: [0, 0, 0] });
  });

  it('malformed cycle payloads are ignored', () => {
    const { host } = setup();
    host.emit('message', { type: 'cycle', button: 99 });
    host.emit('message', { type: 'cycle', button: -1 });
    host.emit('message', { type: 'cycle' });
    expect(host.last('colors')).toBeUndefined();
  });
});
