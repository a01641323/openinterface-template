// Numeric dot-segment comparison; anything non-numeric compares as 0.
export function isNewerVersion(remote, local) {
  const parse = (v) => String(v).split('.').map((s) => parseInt(s, 10) || 0);
  const a = parse(remote);
  const b = parse(local);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}
