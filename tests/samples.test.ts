import { describe, it, expect } from 'vitest';
import type { Signal } from '../src/engine/types';

describe('Signal type', () => {
  it('accepts a valid signal', () => {
    const s: Signal = {
      detector: 'payment',
      risk: 0.9,
      confidence: 0.8,
      reasons: ['receive_but_pays'],
    };
    expect(s.risk).toBeGreaterThan(0.5);
  });
});