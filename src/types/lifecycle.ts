import {strEnum} from '../utils/strEnum';
import * as Events from './events';
import {EventKeys} from './utility';

export const Lifecycle = strEnum([
  'willActivate',
  'active',
  'willIdle',
  'idle',
  'willAddListener',
  'didAddListener',
  'willRemoveListener',
  'didRemoveListener',
  'willDestroy',
  'error'
]);
export type Lifecycle = keyof typeof Lifecycle;

export namespace Lifecycle {
  export interface EventMap<TEventMap extends Events.EventMap> {
    [Lifecycle.willActivate]: void;
    [Lifecycle.active]: void;
    [Lifecycle.willIdle]: void;
    [Lifecycle.idle]: void;
    [Lifecycle.willAddListener]: EventKeys<TEventMap>|Events.WILDCARD;
    [Lifecycle.didAddListener]: EventKeys<TEventMap>|Events.WILDCARD;
    [Lifecycle.willRemoveListener]: EventKeys<TEventMap>|Events.WILDCARD;
    [Lifecycle.didRemoveListener]: EventKeys<TEventMap>|Events.WILDCARD;
    [Lifecycle.willDestroy]: void;
    [Lifecycle.error]: {error: Error, event: EventKeys<TEventMap>|Events.WILDCARD|Lifecycle};
  }
}