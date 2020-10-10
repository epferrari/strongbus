export type EventKeys<T extends object> = Exclude<keyof T, symbol>;

export type ElementType<ArrayType> = ArrayType extends (infer E)[] ? E : never;