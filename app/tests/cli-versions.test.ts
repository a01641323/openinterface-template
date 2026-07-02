import { describe, it, expect } from 'vitest';
import { isNewerVersion } from '../../cli/lib/versions.mjs';

describe('cli isNewerVersion(remote, local)', () => {
  it('detects newer versions', () => {
    expect(isNewerVersion('0.2.0', '0.1.0')).toBe(true);
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(true);
    expect(isNewerVersion('0.1.10', '0.1.9')).toBe(true);
  });
  it('rejects equal or older versions', () => {
    expect(isNewerVersion('0.1.0', '0.1.0')).toBe(false);
    expect(isNewerVersion('0.1.0', '0.2.0')).toBe(false);
  });
  it('handles different segment counts and junk', () => {
    expect(isNewerVersion('0.2', '0.1.9')).toBe(true);
    expect(isNewerVersion('0.1.0.1', '0.1.0')).toBe(true);
    expect(isNewerVersion('not-a-version', '0.1.0')).toBe(false);
  });
});
