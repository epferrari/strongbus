export type EventKeys<T extends object> = keyof T;

export type ElementType<ArrayType> = ArrayType extends (infer E)[] ? E : never;