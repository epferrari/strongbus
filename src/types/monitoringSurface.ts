import type {Subscription, EventMap} from './events';
import type {Lifecycle} from './lifecycle';

interface MonitoringHookObject<in out TEventMap extends EventMap> {
  bivarianceHack<L extends Lifecycle>(
    event: L,
    handler: (payload: Lifecycle.EventMap<TEventMap>[L]) => void
  ): Subscription;
}

export type MonitoringHook<TEventMap extends EventMap> =
  MonitoringHookObject<TEventMap>['bivarianceHack'];

/**
 * Observe {@link Bus} lifecycle and active/idle state.
 */
export interface MonitoringSurface<in out TEventMap extends EventMap = EventMap> {
  hook: MonitoringHook<TEventMap>;

  monitor(handler: (activeState: boolean) => void): Subscription;

  readonly active: boolean;
}
