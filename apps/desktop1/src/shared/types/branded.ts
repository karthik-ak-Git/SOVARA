/**
 * Branded string — compile-time identity, runtime is plain string.
 * Mirrors `packages/util/brand` in DSH without importing it.
 */
declare const __brand: unique symbol
export type Branded<B extends string> = string & { readonly [__brand]: B }

export type SessionId = Branded<'SessionId'>
export type ToolCallId = Branded<'ToolCallId'>
export type ModelId = Branded<'ModelId'>
export type InstanceId = Branded<'InstanceId'>

export function brand<B extends string>(value: string): Branded<B> {
  return value as Branded<B>
}
