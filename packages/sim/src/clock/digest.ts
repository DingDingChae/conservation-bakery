/**
 * Stable digests of simulation state.
 *
 * A digest is only useful if two structurally identical states always produce the
 * same digest — regardless of platform, and regardless of the order keys happened
 * to be inserted in. `canonicalize` guarantees that: keys are always sorted, and
 * every value type has exactly one textual representation. `digest` then hashes
 * that canonical text with FNV-1a.
 */

export type Digestible =
  | null
  | boolean
  | number
  | string
  | bigint
  | readonly Digestible[]
  | ReadonlyMap<string, Digestible>
  | { readonly [key: string]: Digestible };

/**
 * Render a value as a canonical string: sorted object/map keys, and every
 * conserved `bigint` written as a decimal string carrying an explicit `n:` marker
 * so it can never collide with a plain string or number that happens to look the
 * same (the digest of `1n` must differ from the digest of `1` and of `"1"`).
 *
 * This is not JSON — JSON has no bigint and no defined key order — it is a total,
 * unambiguous grammar over `Digestible`, which is all a digest needs.
 */
export function canonicalize(value: Digestible): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'bigint') return `n:${value.toString()}`;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new RangeError(`cannot canonicalize non-finite number ${value}`);
    }
    // -0 and 0 are the same state; they must not digest differently.
    return Object.is(value, -0) ? '0' : value.toString();
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${(value as readonly Digestible[]).map(canonicalize).join(',')}]`;
  }
  if (value instanceof Map) {
    const keys = [...value.keys()].sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value.get(key) as Digestible)}`)
      .join(',')}}`;
  }
  const record = value as { readonly [key: string]: Digestible };
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key] as Digestible)}`)
    .join(',')}}`;
}

/**
 * Encode a string as UTF-8 bytes by hand.
 *
 * `packages/sim` runs headless with no DOM and no Node-only dependency (see
 * CLAUDE.md), so this does not reach for a platform's `TextEncoder` — it reaches
 * for nothing at all. Standard UTF-8: code points below U+80 are one byte, below
 * U+800 two, below U+10000 three, otherwise four, each continuation byte carrying
 * six bits with the `10` prefix.
 */
function utf8Bytes(input: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i += 1) {
    const codePoint = input.codePointAt(i);
    if (codePoint === undefined) continue;
    if (codePoint > 0xffff) i += 1; // this code point consumed a UTF-16 surrogate pair

    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return bytes;
}

const FNV_OFFSET_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/**
 * FNV-1a over the UTF-8 bytes of a string, folded to 64 bits. Simple, dependency
 * free, and more than enough spread for telling simulation states apart — this is
 * a change detector for a replay test, not a cryptographic commitment.
 */
export function fnv1a64(input: string): bigint {
  let hash = FNV_OFFSET_64;
  for (const byte of utf8Bytes(input)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME_64) & MASK_64;
  }
  return hash;
}

/** A stable hex digest of a canonicalized simulation state. */
export function digest(value: Digestible): string {
  return fnv1a64(canonicalize(value)).toString(16).padStart(16, '0');
}
