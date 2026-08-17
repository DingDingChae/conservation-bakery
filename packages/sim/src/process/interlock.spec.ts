import { describe, expect, it } from 'vitest';
import { evaluateInterlock, evaluateInterlocks, type Interlock } from './interlock.js';

describe('interlocks', () => {
  it('accepts a command when every condition is satisfied', () => {
    const interlock: Interlock = {
      id: 'door-closed',
      label: 'hold bake profile',
      protects: 'the bake profile',
      conditions: [{ id: 'door', description: 'door open', isSatisfied: () => true }],
    };
    expect(evaluateInterlock(interlock)).toEqual({ ok: true });
  });

  it('refuses a command and explains why, naming what it protects', () => {
    const interlock: Interlock = {
      id: 'door-closed',
      label: 'hold bake profile',
      protects: 'the bake profile',
      conditions: [{ id: 'door', description: 'door open', isSatisfied: () => false }],
    };
    const result = evaluateInterlock(interlock);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('door open');
      expect(result.reason).toContain('the bake profile');
      expect(result.reason).toContain('hold bake profile');
    }
  });

  it('reports only the first unsatisfied condition, in order', () => {
    const interlock: Interlock = {
      id: 'multi',
      label: 'start mixer',
      protects: 'the mixer drive',
      conditions: [
        { id: 'guard', description: 'guard open', isSatisfied: () => false },
        { id: 'bowl', description: 'bowl not seated', isSatisfied: () => false },
      ],
    };
    const result = evaluateInterlock(interlock);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('guard open');
      expect(result.reason).not.toContain('bowl not seated');
    }
  });

  it('evaluateInterlocks refuses if any interlock in the set refuses', () => {
    const ok: Interlock = {
      id: 'a',
      label: 'a',
      protects: 'equipment a',
      conditions: [{ id: 'x', description: 'x', isSatisfied: () => true }],
    };
    const blocking: Interlock = {
      id: 'b',
      label: 'b',
      protects: 'equipment b',
      conditions: [{ id: 'y', description: 'interlock y not satisfied', isSatisfied: () => false }],
    };
    const result = evaluateInterlocks([ok, blocking]);
    expect(result.ok).toBe(false);
  });

  it('evaluateInterlocks accepts when every interlock in the set accepts', () => {
    const a: Interlock = {
      id: 'a',
      label: 'a',
      protects: 'equipment a',
      conditions: [{ id: 'x', description: 'x', isSatisfied: () => true }],
    };
    const b: Interlock = {
      id: 'b',
      label: 'b',
      protects: 'equipment b',
      conditions: [{ id: 'y', description: 'y', isSatisfied: () => true }],
    };
    expect(evaluateInterlocks([a, b])).toEqual({ ok: true });
  });
});
