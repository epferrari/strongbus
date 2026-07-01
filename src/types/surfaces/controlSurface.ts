import type {EventMap} from '../events';
import type {EventKeys, EventPayload} from '../utility';

/**
 * Emit events and tear down a {@link Bus} instance.
 */
export interface ControlSurface<in out TEventMap extends EventMap = EventMap> {
  emit<T extends EventKeys<TEventMap>>(event: T, ...payload: EventPayload<TEventMap, T>): boolean;

  destroy(): void;
}
