import type {EventMap, WILDCARD} from './events';

export type EventKeys<T extends EventMap> = keyof T;

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