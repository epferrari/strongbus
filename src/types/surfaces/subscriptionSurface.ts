import type {CancelablePromise} from 'jaasync';

import type {Scanner} from '../../scanner';
import type {Bus} from '../../strongbus';
import type {Subscription, EventMap, Listenable, SubscribableListenable} from '../events';
import type {
  EventHandler,
  EventSink,
  TapHandler,
  PipePredicate,
  InferPipeDownstreamMap,
  PipePayloadOverlap
} from '../eventHandlers';
import type {EventKeys, EventPayloadPair, SubscribableEventKeys} from '../utility';

export type AnyEventMap<in out T extends EventMap> = {[K in keyof T]: T[K]};

export type PipeEventMap<in out T extends EventMap> = {[K in keyof T]: T[K]};

export type ScanEventMap<in out T extends EventMap> = {[K in keyof T]: T[K]};

/**
 * Options for registering interest that should not count toward monitoring
 * (`active` / `idle`, default introspection, listener lifecycle hooks).
 */
export interface SubscribeOptions {
  /**
   * When `true`, the registration still receives / forwards events but is invisible
   * to this bus's monitoring subsystem. Default `false`.
   */
  incognito?: boolean;
}

/** Options for {@link SubscriptionSurface.scan}. */
export interface ScanOptions extends SubscribeOptions {
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
  >(events: TEvents, handler: EventSink<TMap>, options?: SubscribeOptions): Subscription;
}['bivarianceHack'];

export type SubscriptionSurfaceTap<in out TEventMap extends EventMap> = {
  bivarianceHack<TMap extends PipeEventMap<TEventMap>>(
    handler: TapHandler<TMap>,
    options?: SubscribeOptions
  ): Subscription;
}['bivarianceHack'];

/**
 * Handle returned by {@link SubscriptionSurface.pipe} when given a {@link PipePredicate}.
 * Call {@link FilteredPipeHandle.pipe} to attach a filtered graph edge.
 */
export type FilteredPipeHandle<in out TEventMap extends EventMap> = {
  pipe: {
    bivarianceHack<TDownstream extends Bus<any>>(
      downstream: TDownstream & PipePayloadOverlap<TEventMap, InferPipeDownstreamMap<TDownstream>>,
      options?: SubscribeOptions
    ): TDownstream;
  }['bivarianceHack'];
};

export type SubscriptionSurfacePipe<in out TEventMap extends EventMap> = {
  bivarianceHack: {
    <TMap extends PipeEventMap<TEventMap>>(
      predicate: PipePredicate<TMap>
    ): FilteredPipeHandle<TMap>;
    <TDownstream extends Bus<any>>(
      downstream: TDownstream & PipePayloadOverlap<TEventMap, InferPipeDownstreamMap<TDownstream>>,
      options?: SubscribeOptions
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
  bivarianceHack: {
    <T extends SubscribableListenable<EventKeys<TEventMap>>>(
      resolutionTrigger: T,
      options?: SubscribeOptions
    ): CancelablePromise<NextResult<TEventMap, T>>;
    <T extends SubscribableListenable<EventKeys<TEventMap>>>(
      resolutionTrigger: T,
      rejectionTrigger: T extends EventKeys<TEventMap>[]
        ? SubscribableListenable<EventKeys<Omit<TEventMap, T[number]>>>
        : T extends EventKeys<TEventMap>
          ? SubscribableListenable<EventKeys<Omit<TEventMap, T>>>
          : never,
      options?: SubscribeOptions
    ): CancelablePromise<NextResult<TEventMap, T>>;
  };
}['bivarianceHack'];

export type SubscriptionSurfaceUnpipe<in out TEventMap extends EventMap> = {
  bivarianceHack<TDownstream extends Bus<any>>(downstream: TDownstream): void;
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
  /**
   * Subscribe a handler to a single event. A second call with the same `event` and
   * handler reference returns the existing {@link Subscription} without adding again.
   */
  on<T extends SubscribableEventKeys<TEventMap>>(
    event: T,
    handler: EventHandler<TEventMap, T>,
    options?: SubscribeOptions
  ): Subscription;

  /**
   * Remove a handler previously registered with {@link SubscriptionSurface.on}.
   * Uses the same handler reference; no-op if that handler is not registered for `event`.
   * Does not remove wrappers created by {@link SubscriptionSurface.once}, {@link SubscriptionSurface.any},
   * or {@link SubscriptionSurface.tap}.
   */
  off<T extends SubscribableEventKeys<TEventMap>>(event: T, handler: EventHandler<TEventMap, T>): void;

  once<T extends SubscribableEventKeys<TEventMap>>(
    event: T,
    handler: EventHandler<TEventMap, T>,
    options?: SubscribeOptions
  ): Subscription;

  any: SubscriptionSurfaceAny<TEventMap>;

  next: SubscriptionSurfaceNext<TEventMap>;

  scan: SubscriptionSurfaceScan<TEventMap>;

  /**
   * Observe every raised event as a correlated {@link import('../eventHandlers').PipedMessage}.
   * Does not create a graph edge. Unsubscribe via the returned {@link Subscription}.
   */
  tap: SubscriptionSurfaceTap<TEventMap>;

  pipe: SubscriptionSurfacePipe<TEventMap>;

  unpipe: SubscriptionSurfaceUnpipe<TEventMap>;
}
