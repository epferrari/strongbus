import type {EventMap} from './events';
import type {MonitoringHook} from './surfaces/monitoringSurface';
import type {SubscriptionSurface} from './surfaces/subscriptionSurface';

/**
 * Surface {@link Scanner} attaches to. {@link MonitoringHook} is defined on
 * {@link MonitoringSurface}; subscribe methods match {@link SubscriptionSurface}.
 */
export type Scannable<TEventMap extends EventMap = EventMap> =
  { readonly name: string; hook: MonitoringHook<TEventMap> } &
  Pick<SubscriptionSurface<TEventMap>, 'on' | 'any' | 'pipe'>;
