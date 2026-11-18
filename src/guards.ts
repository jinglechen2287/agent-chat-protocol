/**
 * Type guards and object helpers shared by the validators. Internal: not
 * re-exported from either entry.
 */

/**
 * Whether `key` is an own property of `object`, so a lookup by an untrusted
 * key can't land on an inherited member such as `constructor` or
 * `__proto__`. Spelled out instead of `Object.hasOwn`, which the client entry
 * can't assume: it runs in browsers older than Safari 15.4 and Chrome 93.
 */
export function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}
