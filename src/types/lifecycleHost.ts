import type {EventMap, WILDCARD} from './events';
import { IntrospectionOptions } from './listenerScope';
import type {EventKeys} from './utility';

/**
 * Bookkeeping and introspection callbacks supplied by {@link Bus} to
 * {@link LifecycleManager}.
 * @internal
 */
export interface LifecycleHost<TEventMap extends EventMap> {
  hasListeners(): boolean;
  getListenerCount(): number;
  getOwnListenerCount(): number;
  getListenerCountFor(event: EventKeys<TEventMap>|WILDCARD): number;
  accountForDownstreamListeners(event: EventKeys<TEventMap>|WILDCARD, count: number): void;
  accountForRemovedDownstreamListeners(event: EventKeys<TEventMap>|WILDCARD, count: number): void;
}
