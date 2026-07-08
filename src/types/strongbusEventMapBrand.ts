import type {EventMap} from './events';

/**
 * Phantom brand carried by {@link Bus} and its subclasses so generic event-map
 * inference survives subclassing, wrapper types, and `forward`/`pipe` delegate
 * targets.
 *
 * Subclasses should redeclare the brand with their map type parameter:
 *
 * ```ts
 * class TypedMsgBus<M extends EventMap> extends Bus<M> implements StrongbusEventMapBranded<M> {
 *   declare readonly strongbusEventMap: M;
 * }
 * ```
 *
 * The property is never assigned at runtime; it exists only for TypeScript.
 */
export interface StrongbusEventMapBranded<TEventMap extends EventMap = EventMap> {
  readonly strongbusEventMap: TEventMap;
}

/** Event map declared on `T` via {@link StrongbusEventMapBranded}. */
export type InferStrongbusEventMap<T> = T extends {readonly strongbusEventMap: infer M extends EventMap}
  ? M
  : never;
