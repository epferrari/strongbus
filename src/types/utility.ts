import {EventMap} from './events';

export type EventKeys<T extends EventMap> = keyof T;

export type ElementType<ArrayType> = ArrayType extends (infer E)[] ? E : never;