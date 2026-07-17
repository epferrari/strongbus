import type {EventMap, WILDCARD} from './events';
import type {EventKeys} from './utility';

/**
 * Bus bookkeeping callbacks supplied to {@link LifecycleManager}.
 * Shared resources (`logger`, `options`) are constructor deps, not host fields.
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
