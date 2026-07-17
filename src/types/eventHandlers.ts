import type {EventKeys} from './utility';
import type {EventMap} from './events';
import type {Bus} from '../strongbus';

/**
 * Handler for a single, specific event `T`. Receives only that event's payload
 * (`TEventMap[T]`). This is the handler shape accepted by {@link Bus.on} and
 * {@link Bus.once}.
 *
 * Declared via the `bivarianceHack` indirection so the payload parameter is
 * bivariant; this lets a `Bus` over a wider event map satisfy a view over a
 * narrower one.
 */
export type EventHandler<TEventMap extends EventMap, T extends EventKeys<TEventMap>> = {
  bivarianceHack(payload: TEventMap[T]): void;
}['bivarianceHack'];

/**
 * @deprecated Use {@link EventHandler} instead.
 */
export type SingleEventHandler<TEventMap extends EventMap, T extends EventKeys<TEventMap>> =
  EventHandler<TEventMap, T>;

/**
 * Handler for any event in `TEventMap`. Receives the raised event as its first
 * argument and that event's payload as its second. This is the handler shape
 * accepted by {@link Bus.any}.
 */
export type EventSink<in out TEventMap extends EventMap> = {
  bivarianceHack(
    event: EventKeys<TEventMap>,
    payload: TEventMap[EventKeys<TEventMap>]
  ): void;
}['bivarianceHack'];

/**
 * A correlated event message: a discriminated union of `{event, payload}` objects,
 * one per key of `TEventMap`. Because each pair is a single value (a union
 * member), narrowing `event` narrows `payload`. This is the first argument handed
 * to a {@link PipeSink}; to forward it onward, call the sink's second argument
 * (`forward`) rather than splitting it back into `(event, payload)`.
 */
export type PipeMessage<TEventMap extends EventMap> = {
  [K in EventKeys<TEventMap>]: {event: K; payload: TEventMap[K]}
}[EventKeys<TEventMap>];

/** @internal Event map carried by a downstream {@link Bus} passed to {@link Bus.pipe} or {@link PipeForward}. */
export type InferPipeDownstreamMap<TDownstream> =
  TDownstream extends Bus<infer M extends EventMap> ? M : never;

/**
 * For events shared by the pipe source and target maps, payload types must match
 * exactly. Source-only events are not required on the target; target-only events
 * are simply never raised by the source.
 */
export type PipePayloadOverlap<TSource extends EventMap, TDownstream extends EventMap> =
  Extract<EventKeys<TSource>, EventKeys<TDownstream>> extends never
    ? unknown
    : {
        [K in Extract<EventKeys<TSource>, EventKeys<TDownstream>>]: [TSource[K]] extends [TDownstream[K]]
          ? [TDownstream[K]] extends [TSource[K]]
            ? true
            : false
          : false;
      } extends infer Result
        ? Exclude<Result[keyof Result], true> extends never
          ? unknown
          : never
        : never;

/**
 * The `forward` function handed to a {@link PipeSink} as its second argument,
 * bound to the current {@link PipeMessage}. Calling `forward(dst)` queues a
 * re-emit of that message on `dst` — like `src.pipe(dst)` but per-message and
 * without registering a downstream link (so none of the listener-lifecycle
 * overhead `pipe(bus)` incurs).
 *
 * Queued emits run in the *delegation* phase of the source `emit`, after every
 * own handler on the source has returned (capture semantics). `forward` is live
 * for the duration of that source `emit`; once the emit completes, further calls
 * resolve to `false` without emitting. The returned promise resolves to
 * `target.emit`'s boolean result when the queued emit runs, or `false` if the
 * forward expired.
 *
 * `dst` must be a {@link Bus} whose map is *payload-compatible* with the source:
 * every event `dst` declares must either be absent from the source or carry the
 * same payload type on every event key they share. This makes it impossible to
 * land an event on `dst` with a payload type `dst` doesn't expect. Source events
 * `dst` doesn't declare are simply dropped by `dst` at runtime.
 */
export type PipeForward<in out TEventMap extends EventMap> = {
  bivarianceHack: <TDownstream extends Bus<any>>(
    dest: TDownstream & PipePayloadOverlap<TEventMap, InferPipeDownstreamMap<TDownstream>>
  ) => Promise<boolean>;
}['bivarianceHack'];

/**
 * Handler for the function-sink form of {@link Bus.pipe} and {@link Bus.unpipe}.
 * Receives the raised event as a single correlated {@link PipeMessage} (so
 * narrowing `message.event` via `if`/`switch` narrows `message.payload` to that
 * event's type), plus a {@link PipeForward} bound to that message for forwarding
 * it onward to another bus:
 *
 * ```ts
 * bus.pipe((message, forward) => {
 *   if (message.event === 'didRemoveItem') {
 *     cache.delete(message.payload.id); // payload narrowed to this event's type
 *   }
 *   forward(otherBus); // queues re-emit after this bus's own handlers
 * });
 * ```
 *
 * Because the message is never split back into `(event, payload)`, a mismatched
 * pair can't be fabricated, and `forward`'s target constraint keeps the payload
 * sound end-to-end. See {@link PipeForward} for deferral, expiry, and the
 * `Promise<boolean>` result.
 *
 * Declared via the `bivarianceHack` indirection so the parameters are bivariant;
 * this lets a `Bus` over a wider event map satisfy a view over a narrower one.
 */
export type PipeSink<in out TEventMap extends EventMap> = {
  bivarianceHack(message: PipeMessage<TEventMap>, forward: PipeForward<TEventMap>): void;
}['bivarianceHack'];

/**
 * Internal, untyped handler shape used for the {@link Bus}'s listener bookkeeping.
 * Not part of the public API.
 * @internal
 */
export type GenericHandler = (...args: any) => void|Promise<void>;
