import type {CancelablePromise} from 'jaasync';

import type {Scanner} from '../../scanner';
import type {Subscription, EventMap, Listenable, SubscribableListenable} from '../events';
import type {
  SingleEventHandler,
  EventSink,
  PipeSink,
  PipeTargetEmit,
  InferPipeDelegateMap,
  PipePayloadOverlap
} from '../eventHandlers';
import type {ControlSurface} from './controlSurface';
import type {EventKeys, EventPayloadPair, SubscribableEventKeys} from '../utility';

export type AnyEventMap<in out T extends EventMap> = {[K in keyof T]: T[K]};

export type PipeEventMap<in out T extends EventMap> = {[K in keyof T]: T[K]};

export type ScanEventMap<in out T extends EventMap> = {[K in keyof T]: T[K]};

/** Options for {@link SubscriptionSurfaceScan}. */
export interface ScanOptions {
  eager?: boolean;
  pool?: boolean;
  timeout?: number;
}

/**
 * @deprecated Pass `trigger` and `evaluator` as separate arguments to {@link SubscriptionSurfaceScan}:
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
    <
      TDelegate,
      TDelegateMap extends EventMap = InferPipeDelegateMap<TDelegate>
    >(
      delegate: TDelegate & {
        emit: PipeTargetEmit<TDelegateMap>;
      } & PipePayloadOverlap<TEventMap, TDelegateMap>
    ): SubscriptionSurface<TDelegateMap>;
  };
}['bivarianceHack'];

/**
 * Await the first matching event as a `CancelablePromise` of `{event, payload}`.
 *
 * Triggers must be {@link SubscribableListenable} values (a single event key or
 * array of keys). The `'*'` wildcard accepted by older {@link Listenable}
 * triggers is not supported — it could not keep event and payload types
 * correlated.
 *
 * **Migrating from `next('*')`**
 *
 * - To resolve on the first of several known events, pass every key:
 *   `next(['foo', 'bar', 'baz'])`. The result discriminates on `event`.
 * - When you need to inspect payload shape, filter events, or resolve only under
 *   a condition, use {@link Bus.scan} — including `trigger: '*'` with an
 *   evaluator that discriminates on `resolve.trigger` (see {@link Scanner.Evaluator}).
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
    <TDelegate extends PipeTarget<TEventMap>>(delegate: TDelegate): void;
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
  on<T extends SubscribableEventKeys<TEventMap>>(event: T, handler: SingleEventHandler<TEventMap, T>): Subscription;

  once<T extends SubscribableEventKeys<TEventMap>>(event: T, handler: SingleEventHandler<TEventMap, T>): Subscription;

  any: SubscriptionSurfaceAny<TEventMap>;

  next: SubscriptionSurfaceNext<TEventMap>;

  scan: SubscriptionSurfaceScan<TEventMap>;

  pipe: SubscriptionSurfacePipe<TEventMap>;

  unpipe: SubscriptionSurfaceUnpipe<TEventMap>;
}

/**
 * A delegate that can receive piped events via {@link Bus.emit}. The returned
 * value is a {@link SubscriptionSurface} over the delegate map for chaining.
 */
export type PipeTarget<TEventMap extends EventMap> = {
  bivarianceHack: SubscriptionSurface<TEventMap> & Pick<ControlSurface<TEventMap>, 'emit'>;
}['bivarianceHack'];
