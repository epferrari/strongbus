export type StringKeys<T extends object> = Exclude<keyof T, number|symbol>;

export type ElementType<ArrayType> = ArrayType extends (infer E)[] ? E : never;