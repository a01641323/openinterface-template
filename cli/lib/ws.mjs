import { createHash, randomBytes } from 'node:crypto';

// Minimal RFC 6455 subset — we control both endpoints (our own browser JS),
// messages are small JSON text frames. Supported: handshake, single-frame
// text/close/ping/pong, client masking. Not supported (not needed):
// fragmentation, extensions, binary payloads.

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export const OPCODE = { TEXT: 0x1, CLOSE: 0x8, PING: 0x9, PONG: 0xa };

export function makeAcceptKey(secWebSocketKey) {
  return createHash('sha1').update(secWebSocketKey + GUID).digest('base64');
}

export function encodeFrame(opcode, payload = Buffer.alloc(0), { mask = false } = {}) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  if (!mask) return Buffer.concat([header, payload]);
  header[1] |= 0x80;
  const key = randomBytes(4);
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i++) masked[i] ^= key[i % 4];
  return Buffer.concat([header, key, masked]);
}

export class FrameDecoder {
  #buf = Buffer.alloc(0);

  push(chunk) {
    this.#buf = this.#buf.length ? Buffer.concat([this.#buf, chunk]) : Buffer.from(chunk);
    const frames = [];
    for (;;) {
      const frame = this.#tryRead();
      if (!frame) return frames;
      frames.push(frame);
    }
  }

  #tryRead() {
    const buf = this.#buf;
    if (buf.length < 2) return null;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f;
    let off = 2;
    if (len === 126) {
      if (buf.length < 4) return null;
      len = buf.readUInt16BE(2);
      off = 4;
    } else if (len === 127) {
      if (buf.length < 10) return null;
      len = Number(buf.readBigUInt64BE(2));
      off = 10;
    }
    if (masked && buf.length < off + 4) return null;
    const maskKey = masked ? buf.subarray(off, off + 4) : null;
    if (masked) off += 4;
    if (buf.length < off + len) return null;
    const payload = Buffer.from(buf.subarray(off, off + len));
    if (maskKey) for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
    this.#buf = buf.subarray(off + len);
    return { opcode, payload };
  }
}

// Wrap a net.Socket as a JSON-message connection with ping/close handling.
function wrapSocket(socket) {
  const decoder = new FrameDecoder();
  const listeners = { message: [], close: [] };
  let closed = false;

  const emitClose = () => {
    if (closed) return;
    closed = true;
    for (const fn of listeners.close) fn();
  };

  const conn = {
    send(obj) {
      if (closed) return;
      try {
        socket.write(encodeFrame(OPCODE.TEXT, Buffer.from(JSON.stringify(obj))));
      } catch {
        /* socket already dead; close event follows */
      }
    },
    close() {
      if (closed) return;
      try {
        socket.write(encodeFrame(OPCODE.CLOSE));
      } catch {
        /* ignore */
      }
      socket.end();
    },
    on(event, fn) {
      listeners[event]?.push(fn);
    },
  };

  socket.on('data', (chunk) => {
    for (const frame of decoder.push(chunk)) {
      if (frame.opcode === OPCODE.TEXT) {
        let msg;
        try {
          msg = JSON.parse(frame.payload.toString());
        } catch {
          continue;
        }
        for (const fn of listeners.message) fn(msg);
      } else if (frame.opcode === OPCODE.PING) {
        try {
          socket.write(encodeFrame(OPCODE.PONG, frame.payload));
        } catch {
          /* ignore */
        }
      } else if (frame.opcode === OPCODE.CLOSE) {
        try {
          socket.write(encodeFrame(OPCODE.CLOSE));
        } catch {
          /* ignore */
        }
        socket.end();
      }
    }
  });
  socket.on('close', emitClose);
  socket.on('error', () => socket.destroy());
  socket.setNoDelay?.(true);
  return conn;
}

// handler: { shouldAccept(req) → boolean, onConnection(conn, req) }
export function attachWebSocket(httpServer, path, handler) {
  httpServer.on('upgrade', (req, socket) => {
    const url = new URL(req.url, 'http://local');
    const key = req.headers['sec-websocket-key'];
    if (url.pathname !== path || !key || req.headers.upgrade?.toLowerCase() !== 'websocket') {
      socket.destroy();
      return;
    }
    if (handler.shouldAccept && !handler.shouldAccept(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${makeAcceptKey(key)}\r\n\r\n`,
    );
    handler.onConnection(wrapSocket(socket), req);
  });
}
