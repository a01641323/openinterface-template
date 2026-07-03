import { describe, it, expect } from 'vitest';
import { makeAcceptKey, encodeFrame, FrameDecoder, OPCODE } from '../../cli/lib/ws.mjs';

describe('makeAcceptKey', () => {
  it('matches the RFC 6455 sample handshake', () => {
    // Key/accept pair straight from RFC 6455 §1.3
    expect(makeAcceptKey('dGhlIHNhbXBsZSBub25jZQ==')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  });
});

describe('frame codec', () => {
  it('round-trips an unmasked text frame (server→client style)', () => {
    const payload = Buffer.from(JSON.stringify({ type: 'colors', colors: [1, 2, 3] }));
    const frames = new FrameDecoder().push(encodeFrame(OPCODE.TEXT, payload));
    expect(frames).toHaveLength(1);
    expect(frames[0].opcode).toBe(OPCODE.TEXT);
    expect(frames[0].payload.equals(payload)).toBe(true);
  });

  it('round-trips a masked text frame (client→server style)', () => {
    const payload = Buffer.from('{"type":"cycle","button":1}');
    const frames = new FrameDecoder().push(encodeFrame(OPCODE.TEXT, payload, { mask: true }));
    expect(frames).toHaveLength(1);
    expect(frames[0].payload.toString()).toBe('{"type":"cycle","button":1}');
  });

  it('handles the 16-bit extended length path (payload > 125 bytes)', () => {
    const payload = Buffer.alloc(300, 0x61);
    const frames = new FrameDecoder().push(encodeFrame(OPCODE.TEXT, payload, { mask: true }));
    expect(frames).toHaveLength(1);
    expect(frames[0].payload.length).toBe(300);
    expect(frames[0].payload.equals(payload)).toBe(true);
  });

  it('reassembles frames delivered one byte at a time', () => {
    const payload = Buffer.from('hello');
    const wire = encodeFrame(OPCODE.TEXT, payload, { mask: true });
    const decoder = new FrameDecoder();
    const out: unknown[] = [];
    for (const byte of wire) out.push(...decoder.push(Buffer.from([byte])));
    expect(out).toHaveLength(1);
    expect((out[0] as { payload: Buffer }).payload.toString()).toBe('hello');
  });

  it('decodes multiple frames from a single chunk', () => {
    const wire = Buffer.concat([
      encodeFrame(OPCODE.TEXT, Buffer.from('one')),
      encodeFrame(OPCODE.PING, Buffer.from('hb')),
      encodeFrame(OPCODE.CLOSE),
    ]);
    const frames = new FrameDecoder().push(wire);
    expect(frames.map((f) => f.opcode)).toEqual([OPCODE.TEXT, OPCODE.PING, OPCODE.CLOSE]);
    expect(frames[0].payload.toString()).toBe('one');
    expect(frames[1].payload.toString()).toBe('hb');
  });
});
