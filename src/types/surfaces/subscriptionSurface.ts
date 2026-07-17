import type {CancelablePromise} from 'jaasync';

import type {Scanner} from '../../scanner';
import type {Bus} from '../../strongbus';
import type {Subscription, EventMap, Listenable, SubscribableListenable} from '../events';
import type {
  EventHandler,
  EventSink,
  PipeSink,
  InferPipeDownstreamMap,
  PipePayloadOverlap
} from '../eventHandlers';
import type {EventKeys, EventPayloadPair, SubscribableEventKeys} from '../utility';

export type AnyEventMap<in out T extends EventMap> = {[K in keyof T]: T[K]};

export type PipeEventMap<in out T extends EventMap> = {[K in keyof T]: T[K]};

export type ScanEventMap<in out T extends EventMap> = {[K in keyof T]: T[K]};

/** Options for {@link SubscriptionSurface.scan}. */
export interface ScanOptions {
  eager?: boolean;
  pool?: boolean;
  timeout?: number;
}

/**
 * @deprecated Pass `trigger` and `evaluator` as separate arguments to {@link SubscriptionSurface.scan}:
 * `scan(trigger, evaluator, options?)`.
 */
export type ScanParams<T, TEventMap extends EventMap, TMap extends ScanEventMap<TEventMap>> = {
  bivarianceHack: {
    evaluator: Scanner.Evaluator<T, TMap>;
    /** {@link Listenable} trigger, including `'*'`. Discriminate on `resolve.trigger` in the evaluator. */
    trigger: Listenable<EventKeys<TMap>> & Listenable<EventKeys<TEventMap>>;
  } & ScanOptions;
}['bivarianceHack'];

export type SubscriptionSurfaceScan<in out TEventMap extends EventMap> = {
  bivarianceHack<
    T = any,
    TMap extends ScanEventMap<TEventMap> = TEventMap
  >(
    trigger: Listenable<EventKeys<TMap>> & Listenable<EventKeys<TEventMap>>,
    evaluator: Scanner.Evaluator<T, TMap>,
    options?: ScanOptions
  ): CancelablePromise<T>;
  /**
   * @deprecated Pass `trigger` and `evaluator` as separate arguments:
   * `scan(trigger, evaluator, options?)`.
   */
  bivarianceHack<
    T = any,
    TMap extends ScanEventMap<TEventMap> = TEventMap
  >(params: ScanParams<T, TEventMap, TMap>): CancelablePromise<T>;
}['bivarianceHack'];

export type SubscriptionSurfaceAny<in out TEventMap extends EventMap> = {
  bivarianceHack<
    TMap extends AnyEventMap<TEventMap>,
    TEvents extends SubscribableEventKeys<TMap>[] & SubscribableEventKeys<TEventMap>[]
  >(events: TEvents, handler: EventSink<TMap>): Subscription;
}['bivarianceHack'];

export type SubscriptionSurfacePipe<in out TEventMap extends EventMap> = {
  bivarianceHack: {
    <TMap extends PipeEventMap<TEventMap>>(sink: PipeSink<TMap>): Subscription;
    <TDownstream extends Bus<any>>(
      downstream: TDownstream & PipePayloadOverlap<TEventMap, InferPipeDownstreamMap<TDownstream>>
    ): TDownstream;
  };
}['bivarianceHack'];

/**
 * Await the first matching event as a `CancelablePromise` of `{event, payload}`.
 *
 * Triggers must be {@link SubscribableListenable} values (a single event key or
 * array of keys). The `'*'` wildcard is not supported — it cannot keep event
 * and payload types correlated.
 *
 * To resolve on the first of several known events, pass every key:
 * `next(['foo', 'bar', 'baz'])`. The result discriminates on `event`.
 *
 * When you need to inspect payload shape, filter events, or resolve only under a
 * condition, use {@link Bus.scan} — including `trigger: '*'` with an evaluator
 * that discriminates on `resolve.trigger` (see {@link Scanner.Evaluator}).
 */
export type SubscriptionSurfaceNext<in out TEventMap extends EventMap> = {
  bivarianceHack<T extends SubscribableListenable<EventKeys<TEventMap>>>(
    resolutionTrigger: T,
    rejectionTrigger?: T extends EventKeys<TEventMap>[]
      ? SubscribableListenable<EventKeys<Omit<TEventMap, T[number]>>>
      : T extends EventKeys<TEventMap>
        ? SubscribableListenable<EventKeys<Omit<TEventMap, T>>>
        : never
  ): CancelablePromise<NextResult<TEventMap, T>>;
}['bivarianceHack'];

export type SubscriptionSurfaceUnpipe<in out TEventMap extends EventMap> = {
  bivarianceHack: {
    <TMap extends PipeEventMap<TEventMap>>(sink: PipeSink<TMap>): void;
    <TDownstream extends Bus<any>>(downstream: TDownstream): void;
  };
}['bivarianceHack'];

export type NextResult<TEventMap extends EventMap, T> =
  T extends EventKeys<TEventMap>[]
    ? EventPayloadPair<TEventMap, T[number]>
    : T extends EventKeys<TEventMap>
      ? EventPayloadPair<TEventMap, T>
      : never;

/**
 * Subscribe, await, scan, and pipe events on a {@link Bus}.
 */
export interface SubscriptionSurface<in out TEventMap extends EventMap = EventMap> {
  on<T extends SubscribableEventKeys<TEventMap>>(event: T, handler: EventHandler<TEventMap, T>): Subscription;

  /**
   * Remove a handler previously registered with {@link SubscriptionSurface.on}.
   * Uses the same handler reference; no-op if that handler is not registered for `event`.
   * Does not remove wrappers created by {@link SubscriptionSurface.once}, {@link SubscriptionSurface.any},
   * or {@link SubscriptionSurface.pipe}.
   */
  off<T extends SubscribableEventKeys<TEventMap>>(event: T, handler: EventHandler<TEventMap, T>): void;

  once<T extends SubscribableEventKeys<TEventMap>>(event: T, handler: EventHandler<TEventMap, T>): Subscription;

  any: SubscriptionSurfaceAny<TEventMap>;

  next: SubscriptionSurfaceNext<TEventMap>;

  scan: SubscriptionSurfaceScan<TEventMap>;

  pipe: SubscriptionSurfacePipe<TEventMap>;

  unpipe: SubscriptionSurfaceUnpipe<TEventMap>;
}
