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

/**
 * Bus event key carried on listener lifecycle payloads and in {@link Lifecycle.error}.
 * Known keys are typed from `TEventMap`; undeclared keys (possible at runtime on a
 * narrowed view of a wider bus) are `string & {}`.
 */
export type LifecycleSubjectEvent<TEventMap extends _EventMap> =
  EventKeys<TEventMap> | WILDCARD | (string & {});

export namespace Lifecycle {
  export interface EventMap<TEventMap extends _EventMap> {
    [Lifecycle.willActivate]: void;
    [Lifecycle.active]: void;
    [Lifecycle.willIdle]: void;
    [Lifecycle.idle]: void;
    [Lifecycle.willAddListener]: LifecycleSubjectEvent<TEventMap>;
    [Lifecycle.didAddListener]: LifecycleSubjectEvent<TEventMap>;
    [Lifecycle.willRemoveListener]: LifecycleSubjectEvent<TEventMap>;
    [Lifecycle.didRemoveListener]: LifecycleSubjectEvent<TEventMap>;
    [Lifecycle.willDestroy]: void;
    [Lifecycle.error]: {error: Error, event: LifecycleSubjectEvent<TEventMap> | Lifecycle};
  }
}