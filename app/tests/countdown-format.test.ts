import { describe, it, expect } from 'vitest';
import { formatRemaining } from '../app/components/Countdown';

describe('formatRemaining', () => {
  it('formats minutes and seconds', () => {
    expect(formatRemaining(5 * 60_000)).toBe('5:00');
    expect(formatRemaining(61_000)).toBe('1:01');
    expect(formatRemaining(9_000)).toBe('0:09');
  });
  it('includes hours when >= 1h', () => {
    expect(formatRemaining(3_600_000)).toBe('1:00:00');
    expect(formatRemaining(2 * 3_600_000 + 5 * 60_000 + 3_000)).toBe('2:05:03');
  });
  it('shows expired at or below zero', () => {
    expect(formatRemaining(0)).toBe('expired');
    expect(formatRemaining(-1)).toBe('expired');
    expect(formatRemaining(500)).toBe('0:01'); // sub-second remainder rounds up
  });
});
