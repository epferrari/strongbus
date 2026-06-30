import type {CancelablePromise} from 'jaasync';

import type {Scanner} from '../scanner';
import type {Subscription, EventMap, Listenable, WILDCARD} from './events';
import type {SingleEventHandler, EventSink} from './eventHandlers';
import type {EventListenerMapKey, ListenerSet} from './listenerRegistry';
import type {ListenerScope} from './listenerScope';
import type {Scannable} from './scannable';
import type {EventKeys, EventPayload, EventPayloadPair, SubscribableEventKeys} from './utility';

export type {EventListenerMapKey, ListenerSet} from './listenerRegistry';
export {ListenerScope} from './listenerScope';

export type AnyEventMap<in out T extends EventMap> = {[K in keyof T]: T[K]};

export type PipeEventMap<in out T extends EventMap> = {[K in keyof T]: T[K]};

export type ScanEventMap<in out T extends EventMap> = {[K in keyof T]: T[K]};

interface ScanParamsObject<T, in out TEventMap extends EventMap, in out TMap extends ScanEventMap<TEventMap>> {
  bivarianceHack: {
    evaluator: Scanner.Evaluator<T, TMap>;
    trigger: Listenable<EventKeys<TMap>> & Listenable<EventKeys<TEventMap>>;
    eager?: boolean;
    pool?: boolean;
    timeout?: number;
  };
}

export type ScanParams<T, TEventMap extends EventMap, TMap extends ScanEventMap<TEventMap>> =
  ScanParamsObject<T, TEventMap, TMap>['bivarianceHack'];

interface SubscriptionSurfaceScanObject<in out TEventMap extends EventMap> {
  bivarianceHack<
    T = any,
    TMap extends ScanEventMap<TEventMap> = TEventMap
  >(params: ScanParams<T, TEventMap, TMap>): CancelablePromise<T>;
}

export type SubscriptionSurfaceScan<TEventMap extends EventMap> =
  SubscriptionSurfaceScanObject<TEventMap>['bivarianceHack'];

interface SubscriptionSurfaceAnyObject<in out TEventMap extends EventMap> {
  bivarianceHack<
    TMap extends AnyEventMap<TEventMap>,
    TEvents extends SubscribableEventKeys<TMap>[] & SubscribableEventKeys<TEventMap>[]
  >(events: TEvents, handler: EventSink<TMap>): Subscription;
}

export type SubscriptionSurfaceAny<TEventMap extends EventMap> =
  SubscriptionSurfaceAnyObject<TEventMap>['bivarianceHack'];

interface SubscriptionSurfacePipeObject<in out TEventMap extends EventMap> {
  bivarianceHack: {
    <TMap extends PipeEventMap<TEventMap>>(sink: EventSink<TMap>): Subscription;
    <TDelegate extends PipeTarget<TEventMap>>(delegate: TDelegate): TDelegate & SubscriptionSurface<TEventMap>;
  };
}

export type SubscriptionSurfacePipe<TEventMap extends EventMap> =
  SubscriptionSurfacePipeObject<TEventMap>['bivarianceHack'];

interface SubscriptionSurfaceNextObject<in out TEventMap extends EventMap> {
  bivarianceHack<T extends Listenable<EventKeys<TEventMap>>>(
    resolutionTrigger: T,
    rejectionTrigger?: T extends WILDCARD
      ? never
      : T extends EventKeys<TEventMap>[]
        ? EventKeys<Omit<TEventMap, T[number]>>|EventKeys<Omit<TEventMap, T[number]>>[]
        : T extends EventKeys<TEventMap>
          ? EventKeys<Omit<TEventMap, T>>|EventKeys<Omit<TEventMap, T>>[]
          : never
  ): CancelablePromise<NextResult<TEventMap, T>>;
}

export type SubscriptionSurfaceNext<TEventMap extends EventMap> =
  SubscriptionSurfaceNextObject<TEventMap>['bivarianceHack'];

interface SubscriptionSurfaceUnpipeObject<in out TEventMap extends EventMap> {
  bivarianceHack<TDelegate extends (PipeTarget<TEventMap>|EventSink<TEventMap>)>(dest: TDelegate): void;
}

export type SubscriptionSurfaceUnpipe<TEventMap extends EventMap> =
  SubscriptionSurfaceUnpipeObject<TEventMap>['bivarianceHack'];

interface SubscriptionSurfaceHasListenersForEventObject<in out TEventMap extends EventMap> {
  bivarianceHack(event: EventListenerMapKey<TEventMap>, scope: ListenerScope): boolean;
}

export type SubscriptionSurfaceHasListenersForEvent<TEventMap extends EventMap> =
  SubscriptionSurfaceHasListenersForEventObject<TEventMap>['bivarianceHack'];

interface SubscriptionSurfaceListenerForEventObject<in out TEventMap extends EventMap> {
  bivarianceHack(event: EventListenerMapKey<TEventMap>, scope: ListenerScope): ListenerSet;
}

export type SubscriptionSurfaceListenerForEvent<TEventMap extends EventMap> =
  SubscriptionSurfaceListenerForEventObject<TEventMap>['bivarianceHack'];

interface SubscriptionSurfaceListenerCountForEventObject<in out TEventMap extends EventMap> {
  bivarianceHack(event: EventListenerMapKey<TEventMap>, scope: ListenerScope): number;
}

export type SubscriptionSurfaceListenerCountForEvent<TEventMap extends EventMap> =
  SubscriptionSurfaceListenerCountForEventObject<TEventMap>['bivarianceHack'];

interface SubscriptionSurfaceListenerForEachObject<in out TEventMap extends EventMap> {
  bivarianceHack<
    TMap extends AnyEventMap<TEventMap>
  >(
    fn: (event: EventListenerMapKey<TMap>, handlers: ListenerSet) => void,
    scope: ListenerScope
  ): void;
}

export type SubscriptionSurfaceListenerForEach<TEventMap extends EventMap> =
  SubscriptionSurfaceListenerForEachObject<TEventMap>['bivarianceHack'];

export type NextResult<TEventMap extends EventMap, T> =
  T extends WILDCARD
    ? EventPayloadPair<TEventMap, EventKeys<TEventMap>>
    : T extends EventKeys<TEventMap>[]
      ? EventPayloadPair<TEventMap, T[number]>
      : T extends EventKeys<TEventMap>
        ? EventPayloadPair<TEventMap, T>
        : never;

/**
 * The public subscription and introspection surface of {@link Bus}, excluding
 * {@link Bus.emit}.
 */
export interface SubscriptionSurface<in out TEventMap extends EventMap = EventMap> extends Scannable<TEventMap> {
  once<T extends SubscribableEventKeys<TEventMap>>(event: T, handler: SingleEventHandler<TEventMap, T>): Subscription;

  any: SubscriptionSurfaceAny<TEventMap>;

  next: SubscriptionSurfaceNext<TEventMap>;

  scan: SubscriptionSurfaceScan<TEventMap>;

  pipe: SubscriptionSurfacePipe<TEventMap>;

  unpipe: SubscriptionSurfaceUnpipe<TEventMap>;

  monitor(handler: (activeState: boolean) => void): Subscription;

  readonly active: boolean;

  hasListeners(scope: ListenerScope): boolean;

  getListenerCount(scope: ListenerScope): number;

  getListeners(scope: ListenerScope): ListenerSet;

  getEventCount(scope: ListenerScope): number;

  hasListenersFor: SubscriptionSurfaceHasListenersForEvent<TEventMap>;

  getListenerCountFor: SubscriptionSurfaceListenerCountForEvent<TEventMap>;

  getListenersFor: SubscriptionSurfaceListenerForEvent<TEventMap>;

  forEach: SubscriptionSurfaceListenerForEach<TEventMap>;

  destroy(): void;
}

/** A delegate that can receive piped events via {@link Bus.emit}. */
export type PipeTarget<TEventMap extends EventMap> = {
  bivarianceHack: SubscriptionSurface<TEventMap> & {
    emit<T extends EventKeys<TEventMap>>(event: T, ...payload: EventPayload<TEventMap, T>): boolean;
  };
}['bivarianceHack'];
