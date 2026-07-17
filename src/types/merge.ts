import type {EventMap} from './events';

/**
 * Flattens two event maps into one, with `Base` winning on any overlapping key.
 *
 * Unlike an intersection (`Base & Ext`) — which keeps both constituents and thus
 * *intersects* the payloads of overlapping keys — `Merge` produces a single
 * flattened map where every key resolves to exactly one payload. This matters
 * when one of the maps is an open generic type parameter: indexing an
 * intersection `(Fixed & TGeneric)[K]` yields a deferred type (e.g.
 * `string & TGeneric[K]`), so a plain literal payload can't be emitted. A
 * flattened `Merge` sidesteps that.
 *
 * Position matters when merging with an open generic. A key resolves cleanly only
 * when it lives in a layer whose *keyset* is concrete, before any layer that folds
 * in the open generic's keyset. Prefer `Merge<AllFixedEvents, TGeneric>` — every
 * fixed map flattened together as `Base`, the open generic as the sole `Ext` —
 * over nesting the generic inside an inner layer.
 *
 * @typeParam Base - the map whose payloads win on overlapping keys
 * @typeParam Ext - the map contributing any keys not already present on `Base`
 */
export type Merge<Base extends EventMap, Ext extends EventMap> = {
  [K in keyof Base | keyof Ext]: K extends keyof Base
    ? Base[K]
    : K extends keyof Ext
      ? Ext[K]
      : never;
};
