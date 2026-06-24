import {strEnum} from '../utils/strEnum';
import {type EventMap as _EventMap, WILDCARD} from './events';
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
  export interface EventMap<TEventMap extends _EventMap> {
    [Lifecycle.willActivate]: void;
    [Lifecycle.active]: void;
    [Lifecycle.willIdle]: void;
    [Lifecycle.idle]: void;
    [Lifecycle.willAddListener]: EventKeys<TEventMap>|WILDCARD;
    [Lifecycle.didAddListener]: EventKeys<TEventMap>|WILDCARD;
    [Lifecycle.willRemoveListener]: EventKeys<TEventMap>|WILDCARD;
    [Lifecycle.didRemoveListener]: EventKeys<TEventMap>|WILDCARD;
    [Lifecycle.willDestroy]: void;
    [Lifecycle.error]: {error: Error, event: EventKeys<TEventMap>|WILDCARD|Lifecycle};
  }
}