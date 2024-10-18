import {EventMap} from './events';

export type EventKeys<T extends EventMap> = keyof T;

export type ElementType<ArrayType> = ArrayType extends (infer E)[] ? E : never;

export type EventPayload<T extends EventMap, E extends keyof T> = T[E] extends void
  ? ([] | [null] | [undefined])
  : [T[E]];