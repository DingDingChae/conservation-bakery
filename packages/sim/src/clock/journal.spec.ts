import { describe, expect, it } from 'vitest';
import { Journal, type Command } from './journal.js';

type MoveCommand = Command<'move', { readonly amount: string }>;

function moveAt(tick: number, amount: string): MoveCommand {
  return { type: 'move', tick, payload: { amount } };
}

describe('Journal', () => {
  it('records the seed and start instant it was created with', () => {
    const journal = new Journal<MoveCommand>({ seed: 42, startInstantMs: 1000 });
    expect(journal.seed).toBe(42);
    expect(journal.startInstantMs).toBe(1000);
    expect(journal.commands).toEqual([]);
  });

  it('appends commands in order', () => {
    const journal = new Journal<MoveCommand>({ seed: 1, startInstantMs: 0 });
    journal.append(moveAt(1, '10'));
    journal.append(moveAt(1, '20'));
    journal.append(moveAt(3, '30'));
    expect(journal.commands).toEqual([moveAt(1, '10'), moveAt(1, '20'), moveAt(3, '30')]);
  });

  it('rejects a command appended out of tick order', () => {
    const journal = new Journal<MoveCommand>({ seed: 1, startInstantMs: 0 });
    journal.append(moveAt(5, '10'));
    expect(() => journal.append(moveAt(4, '10'))).toThrow(RangeError);
  });

  it('at() returns only the commands stamped for that exact tick, in append order', () => {
    const journal = new Journal<MoveCommand>({ seed: 1, startInstantMs: 0 });
    journal.append(moveAt(1, 'a'));
    journal.append(moveAt(2, 'b'));
    journal.append(moveAt(2, 'c'));
    expect(journal.at(2)).toEqual([moveAt(2, 'b'), moveAt(2, 'c')]);
    expect(journal.at(99)).toEqual([]);
  });

  it('round-trips through serialize/deserialize exactly', () => {
    const journal = new Journal<MoveCommand>({ seed: 777, startInstantMs: 123456 });
    journal.append(moveAt(1, '10'));
    journal.append(moveAt(4, '-5'));
    journal.append(moveAt(4, '999999999999999999'));

    const restored = Journal.deserialize<MoveCommand>(journal.serialize());

    expect(restored.seed).toBe(journal.seed);
    expect(restored.startInstantMs).toBe(journal.startInstantMs);
    expect(restored.commands).toEqual(journal.commands);
  });

  it('round-trips through toRecord/fromRecord exactly', () => {
    const journal = new Journal<MoveCommand>({ seed: 3, startInstantMs: 5 });
    journal.append(moveAt(0, '1'));
    const restored = Journal.fromRecord(journal.toRecord());
    expect(restored.commands).toEqual(journal.commands);
    expect(restored.seed).toBe(3);
    expect(restored.startInstantMs).toBe(5);
  });

  it('rejects JSON that is not an object', () => {
    expect(() => Journal.deserialize('42')).toThrow(TypeError);
    expect(() => Journal.deserialize('null')).toThrow(TypeError);
  });

  it('rejects JSON missing seed or startInstantMs', () => {
    expect(() => Journal.deserialize(JSON.stringify({ commands: [] }))).toThrow(TypeError);
    expect(() =>
      Journal.deserialize(JSON.stringify({ seed: 1, commands: [] })),
    ).toThrow(TypeError);
  });

  it('rejects a malformed command list', () => {
    const badJson = JSON.stringify({
      seed: 1,
      startInstantMs: 0,
      commands: [{ type: 'move', tick: 'not-a-number', payload: {} }],
    });
    expect(() => Journal.deserialize(badJson)).toThrow(TypeError);

    const notAnArray = JSON.stringify({ seed: 1, startInstantMs: 0, commands: {} });
    expect(() => Journal.deserialize(notAnArray)).toThrow(TypeError);
  });
});
