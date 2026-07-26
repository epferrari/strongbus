import type {Bus} from '../../strongbus';
import type {EventMap} from '../events';
import type {EventKeys, VoidEventKeys} from '../utility';
import {brand, isObjectWithFunctions, unwrapSurface} from './utils';

/**
 * Callable shape of {@link EmittingSurface.emit}. Declared via `bivarianceHack`
 * so Wide→Narrow assignability matches other surface callables under
 * `strictFunctionTypes`.
 */
export type EmittingSurfaceEmit<TEventMap extends EventMap> = {
  bivarianceHack: {
    /** Emit a `void` event with no payload (or an explicit `null`/`undefined`). */
    <T extends VoidEventKeys<TEventMap>>(event: T, payload?: null | undefined): boolean;
    /**
     * Emit an event with its correlated payload. The payload is required for any
     * event whose mapped type is not `void`; correlating it directly (rather than
     * through a rest tuple) lets it type-check even when `TEventMap` is a generic
     * type parameter, or when forwarding by a generic key over a concrete map
     * (`T extends keyof M`).
     */
    <T extends EventKeys<TEventMap>>(event: T, payload: TEventMap[T]): boolean;
    /**
     * Correlated-tuple form: the `(event, payload)` pair must be one of the
     * `[event, payload]` tuples of `TEventMap`. Use this after discriminating on
     * `event` when both values started as independent unions.
     */
    (
      ...args: {[K in EventKeys<TEventMap>]: [event: K, payload: TEventMap[K]]}[EventKeys<TEventMap>]
    ): boolean;
  };
}['bivarianceHack'];

/**
 * Raise events on a {@link Bus} without lifecycle teardown.
 *
 * Event-map typing is bivariant (no `in out`) so a surface over a wider map is
 * assignable to a narrower view — the same Wide→Narrow shape as {@link Bus}.
 */
export interface EmittingSurface<TEventMap extends EventMap = EventMap> {
  emit: EmittingSurfaceEmit<TEventMap>;
}

type InferEmittingEventMap<S> =
  S extends {readonly [EmittingSurface.BRAND]: infer V}
    ? V extends Bus<infer M> ? M
      : V extends EmittingSurface<infer Q> ? Q
        : never
    : S extends Bus<infer M> ? M
      : S extends EmittingSurface<infer Q> ? Q
        : never;

/**
 * Unwrap a {@link EmittingSurface}, {@link Bus}, or {@link EmittingSurface.Branded} carrier.
 *
 * Event-map inference prefers {@link Bus}'s type argument when the brand slot (or
 * argument) is a `Bus`, because `emit`'s overload shape does not reverse-infer
 * from `Bus` the way {@link SubscriptionSurface.on} does.
 */
export function EmittingSurface<
  S extends EmittingSurface.Branded<any> | EmittingSurface<any> | Bus<any>
>(s: S): EmittingSurface<InferEmittingEventMap<S>> {
  return unwrapSurface(
    s,
    EmittingSurface.BRAND,
    isEmittingSurface
  ) as EmittingSurface<InferEmittingEventMap<S>>;
}

function isEmittingSurface(value: unknown): value is EmittingSurface {
  return isObjectWithFunctions(value, ['emit']);
}

export namespace EmittingSurface {
  export const BRAND = brand('Emitting');

  /** An object that exposes a {@link EmittingSurface} under {@link BRAND}. */
  export type Branded<T extends EventMap = EventMap> = {
    readonly [BRAND]: EmittingSurface<T>;
  };
}
