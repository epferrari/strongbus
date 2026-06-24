import type {CancelablePromise} from 'jaasync';

import type {Scanner} from '../scanner';
import type {Subscription, EventMap, Listenable, WILDCARD} from './events';
import type {SingleEventHandler, EventSink} from './eventHandlers';
import type {Scannable} from './scannable';
import type {EventKeys, EventPayload, EventPayloadPair, SubscribableEventKeys} from './utility';

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

interface EventProducerScanObject<in out TEventMap extends EventMap> {
  bivarianceHack<
    T = any,
    TMap extends ScanEventMap<TEventMap> = TEventMap
  >(params: ScanParams<T, TEventMap, TMap>): CancelablePromise<T>;
}

export type EventProducerScan<TEventMap extends EventMap> =
  EventProducerScanObject<TEventMap>['bivarianceHack'];

interface EventProducerAnyObject<in out TEventMap extends EventMap> {
  bivarianceHack<
    TMap extends AnyEventMap<TEventMap>,
    TEvents extends SubscribableEventKeys<TMap>[] & SubscribableEventKeys<TEventMap>[]
  >(events: TEvents, handler: EventSink<TMap>): Subscription;
}

export type EventProducerAny<TEventMap extends EventMap> =
  EventProducerAnyObject<TEventMap>['bivarianceHack'];

interface EventProducerPipeObject<in out TEventMap extends EventMap> {
  bivarianceHack: {
    <TMap extends PipeEventMap<TEventMap>>(sink: EventSink<TMap>): Subscription;
    <TDelegate extends PipeTarget<TEventMap>>(delegate: TDelegate): TDelegate & EventProducer<TEventMap>;
  };
}

export type EventProducerPipe<TEventMap extends EventMap> =
  EventProducerPipeObject<TEventMap>['bivarianceHack'];

interface EventProducerNextObject<in out TEventMap extends EventMap> {
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

export type EventProducerNext<TEventMap extends EventMap> =
  EventProducerNextObject<TEventMap>['bivarianceHack'];

interface EventProducerUnpipeObject<in out TEventMap extends EventMap> {
  bivarianceHack<TDelegate extends (PipeTarget<TEventMap>|EventSink<TEventMap>)>(dest: TDelegate): void;
}

export type EventProducerUnpipe<TEventMap extends EventMap> =
  EventProducerUnpipeObject<TEventMap>['bivarianceHack'];

interface EventListenerMapKeyObject<in out TEventMap extends EventMap> {
  bivarianceHack: EventKeys<TEventMap>|WILDCARD;
}

export type EventListenerMapKey<TEventMap extends EventMap> =
  EventListenerMapKeyObject<TEventMap>['bivarianceHack'];

interface EventProducerListenerCheckObject<in out TEventMap extends EventMap> {
  bivarianceHack(event: EventListenerMapKey<TEventMap>): boolean;
}

export type EventProducerListenerCheck<TEventMap extends EventMap> =
  EventProducerListenerCheckObject<TEventMap>['bivarianceHack'];

interface EventProducerListenerCountObject<in out TEventMap extends EventMap> {
  bivarianceHack(event: EventListenerMapKey<TEventMap>): number;
}

export type EventProducerListenerCount<TEventMap extends EventMap> =
  EventProducerListenerCountObject<TEventMap>['bivarianceHack'];

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
 * {@link Bus.emit}. {@link Bus.listeners} and {@link Bus.ownListeners} remain
 * on {@link Bus} only, since {@link ReadonlyMap} keys are invariant in
 * {@link TEventMap} and would break contravariant views.
 */
export interface EventProducer<in out TEventMap extends EventMap = EventMap> extends Scannable<TEventMap> {
  once<T extends SubscribableEventKeys<TEventMap>>(event: T, handler: SingleEventHandler<TEventMap, T>): Subscription;

  any: EventProducerAny<TEventMap>;

  next: EventProducerNext<TEventMap>;

  scan: EventProducerScan<TEventMap>;

  pipe: EventProducerPipe<TEventMap>;

  unpipe: EventProducerUnpipe<TEventMap>;

  monitor(handler: (activeState: boolean) => void): Subscription;

  readonly active: boolean;

  readonly hasListeners: boolean;
  readonly hasOwnListeners: boolean;
  readonly hasDelegateListeners: boolean;

  readonly listenerCount: number;

  hasListenersFor: EventProducerListenerCheck<TEventMap>;
  hasOwnListenersFor: EventProducerListenerCheck<TEventMap>;
  hasDelegateListenersFor: EventProducerListenerCheck<TEventMap>;

  getListenerCountFor: EventProducerListenerCount<TEventMap>;
  getOwnListenerCountFor: EventProducerListenerCount<TEventMap>;
  getDelegateListenerCountFor: EventProducerListenerCount<TEventMap>;

  destroy(): void;
}

/** A delegate that can receive piped events via {@link Bus.emit}. */
export type PipeTarget<TEventMap extends EventMap> = {
  bivarianceHack: EventProducer<TEventMap> & {
    emit<T extends EventKeys<TEventMap>>(event: T, ...payload: EventPayload<TEventMap, T>): boolean;
  };
}['bivarianceHack'];
