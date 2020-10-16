import {strEnum} from '../utils/strEnum';
import * as Events from './events';

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
  export interface EventMap<TEventMap extends object> {
    [Lifecycle.willActivate]: void;
    [Lifecycle.active]: void;
    [Lifecycle.willIdle]: void;
    [Lifecycle.idle]: void;
    [Lifecycle.willAddListener]: (keyof TEventMap)|Events.WILDCARD;
    [Lifecycle.didAddListener]: (keyof TEventMap)|Events.WILDCARD;
    [Lifecycle.willRemoveListener]: (keyof TEventMap)|Events.WILDCARD;
    [Lifecycle.didRemoveListener]: (keyof TEventMap)|Events.WILDCARD;
    [Lifecycle.willDestroy]: void;
    [Lifecycle.error]: {error: Error, event: (keyof TEventMap)|Events.WILDCARD|Lifecycle};
  }
}