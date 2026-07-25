import type {Bus} from '../../strongbus';
import type {EventMap} from '../events';
import {brand} from './brand';
import type {EmittingSurface} from './emittingSurface';

/**
 * Emit events and tear down a {@link Bus} instance.
 *
 * Extends {@link EmittingSurface} with {@link ControlSurface.destroy}. Prefer
 * {@link EmittingSurface} when a dependency may raise events but must not
 * destroy the bus.
 *
 * Event-map typing is bivariant (no `in out`) so a surface over a wider map is
 * assignable to a narrower view — the same Wide→Narrow shape as {@link Bus}.
 */
export interface ControlSurface<TEventMap extends EventMap = EventMap>
  extends EmittingSurface<TEventMap> {
  destroy(): void;
}

type InferControlEventMap<S> =
  S extends {readonly [ControlSurface.BRAND]: infer V}
    ? V extends Bus<infer M> ? M
      : V extends ControlSurface<infer M> ? M
        : never
    : S extends Bus<infer M> ? M
      : S extends ControlSurface<infer M> ? M
        : never;

/**
 * Unwrap a {@link ControlSurface}, {@link Bus}, or {@link ControlSurface.Branded} carrier.
 *
 * Same {@link Bus}-first event-map inference as {@link EmittingSurface} — `emit`
 * does not reverse-infer from `Bus` on its own.
 */
export function ControlSurface<
  S extends ControlSurface.Branded<any> | ControlSurface<any> | Bus<any>
>(s: S): ControlSurface<InferControlEventMap<S>> {
  return (
    ControlSurface.BRAND in s ? (s as ControlSurface.Branded<any>)[ControlSurface.BRAND] : s
  ) as ControlSurface<InferControlEventMap<S>>;
}

export namespace ControlSurface {
  export const BRAND = brand('Control');

  /** An object that exposes a {@link ControlSurface} under {@link BRAND}. */
  export type Branded<T extends EventMap = EventMap> = {
    readonly [BRAND]: ControlSurface<T>;
  };
}
