import type {EventMap, WILDCARD} from './events';

export type EventKeys<T extends EventMap> = keyof T;

/**
 * `true` when `T` is a union of more than one member, `false` for a single
 * member, and deferred for a naked (unresolved) type parameter. Used by
 * {@link ControlSurface.emit} to reject a union-typed event key — which would
 * otherwise pair with a union-typed payload without any correlation proof.
 */
export type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;

/** Event keys that may be passed to {@link Bus.on}, {@link Bus.once}, and {@link Bus.any}. */
export type SubscribableEventKeys<T extends EventMap> = Exclude<EventKeys<T>, WILDCARD>;

export type ElementType<ArrayType> = ArrayType extends (infer E)[] ? E : never;

export type EventPayload<T extends EventMap, E extends keyof T> = T[E] extends void
  ? ([] | [null] | [undefined])
  : [T[E]];

/**
 * Event keys whose payload type is `void`, i.e. those that may be emitted
 * without a payload. Used to type the void-event overload of {@link Bus.emit}.
 */
export type VoidEventKeys<T extends EventMap> = {
  [K in EventKeys<T>]: T[K] extends void ? K : never;
}[EventKeys<T>];

/**
 * A discriminated `{event, payload}` pair over the events `E`, correlating each
 * event with its payload type from `TEventMap`.
 */
export type EventPayloadPair<TEventMap extends EventMap, E extends EventKeys<TEventMap>> = {
  [K in E]: {event: K, payload: TEventMap[K]}
}[E];