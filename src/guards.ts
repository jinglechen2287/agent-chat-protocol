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

/** A plain object: not null, not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A string with at least one non-whitespace character. */
export function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** A string other than `""`. Whitespace counts. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/** A non-negative safe integer: a message index, a count, a byte size. */
export function isIndex(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/**
 * A guard for one member of a string union. Taking a `Record` instead of a
 * list makes the compiler demand every member, so the guard cannot fall
 * behind the union it checks.
 */
export function memberOf<K extends string>(
  members: Record<K, true>,
): (value: unknown) => value is K {
  return (value): value is K => typeof value === "string" && hasOwn(members, value);
}

/** `T` with every key that may hold `undefined` made optional instead. */
export type DefinedProps<T> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

/**
 * Copies `props` without its `undefined`-valued keys, in the same order. Under
 * `exactOptionalPropertyTypes` an optional field must be absent rather than
 * `undefined`; this states that once instead of a conditional spread per field.
 */
export function definedProps<T extends Record<string, unknown>>(props: T): DefinedProps<T> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    if (props[key] !== undefined) out[key] = props[key];
  }
  return out as DefinedProps<T>;
}
