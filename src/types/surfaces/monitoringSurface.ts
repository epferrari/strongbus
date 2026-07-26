import type {Subscription, EventMap} from '../events';
import type {Lifecycle} from '../lifecycle';
import {brand, isObjectWithFunctions, unwrapSurface} from './utils';

export type MonitoringHook<TEventMap extends EventMap> = {
  bivarianceHack<L extends Lifecycle>(
    event: L,
    handler: (payload: Lifecycle.EventMap<TEventMap>[L]) => void
  ): Subscription;
}['bivarianceHack'];

/**
 * Observe {@link Bus} lifecycle and active/idle state.
 *
 * Event-map typing is bivariant (no `in out`) so a surface over a wider map is
 * assignable to a narrower view — the same Wide→Narrow shape as {@link Bus}.
 */
export interface MonitoringSurface<TEventMap extends EventMap = EventMap> {
  hook: MonitoringHook<TEventMap>;

  monitor(handler: (activeState: boolean) => void): Subscription;

  readonly active: boolean;
}

/**
 * Unwrap a {@link MonitoringSurface} or a {@link MonitoringSurface.Branded} carrier.
 */
export function MonitoringSurface<T extends EventMap>(
  s: MonitoringSurface<T> | MonitoringSurface.Branded<T>
): MonitoringSurface<T> {
  return unwrapSurface(s, MonitoringSurface.BRAND, isMonitoringSurface) as MonitoringSurface<T>;
}

function isMonitoringSurface(value: unknown): value is MonitoringSurface {
  return isObjectWithFunctions(value, ['hook', 'monitor']);
}

export namespace MonitoringSurface {
  export const BRAND = brand('Monitoring');

  /** An object that exposes a {@link MonitoringSurface} under {@link BRAND}. */
  export type Branded<T extends EventMap = EventMap> = {
    readonly [BRAND]: MonitoringSurface<T>;
  };
}
