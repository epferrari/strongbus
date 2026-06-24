import type {EventMap} from './events';

export type EventKeys<T extends EventMap> = keyof T;

export type ElementType<ArrayType> = ArrayType extends (infer E)[] ? E : never;

export type EventPayload<T extends EventMap, E extends keyof T> = T[E] extends void
  ? ([] | [null] | [undefined])
  : [T[E]];

/**
 * A discriminated `{event, payload}` pair over the events `E`, correlating each
 * event with its payload type from `TEventMap`.
 */
export type EventPayloadPair<TEventMap extends EventMap, E extends EventKeys<TEventMap>> = {
  [K in E]: {event: K, payload: TEventMap[K]}
}[E];