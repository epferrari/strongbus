import type {EventMap, WILDCARD} from './events';
import type {GenericHandler} from './eventHandlers';
import type {EventKeys} from './utility';

export type EventListenerMapKey<TEventMap extends EventMap> =
  EventKeys<TEventMap> | WILDCARD;

export type AnyEventMap<in out T extends EventMap> = {[K in keyof T]: T[K]};

/** Handlers registered for a single event (or the wildcard sink). */
export type ListenerSet = ReadonlySet<GenericHandler>;

export const EMPTY_LISTENER_SET: ListenerSet = new Set();


interface ListenerRegistryGetObject<in out TEventMap extends EventMap> {
  bivarianceHack(event: EventListenerMapKey<TEventMap>): ListenerSet | undefined;
}

export type ListenerRegistryGet<TEventMap extends EventMap> =
  ListenerRegistryGetObject<TEventMap>['bivarianceHack'];

interface ListenerRegistryGetCountObject<in out TEventMap extends EventMap> {
  bivarianceHack(event: EventListenerMapKey<TEventMap>): number;
}

export type ListenerRegistryGetCount<TEventMap extends EventMap> =
  ListenerRegistryGetCountObject<TEventMap>['bivarianceHack'];

interface ListenerRegistryForEachHandlerObject<in out TEventMap extends EventMap> {
  bivarianceHack(handlers: ListenerSet, event: EventListenerMapKey<TEventMap>): void;
}

export type ListenerRegistryForEachHandler<TEventMap extends EventMap> =
  ListenerRegistryForEachHandlerObject<TEventMap>['bivarianceHack'];

interface ListenerRegistryForEachObject<in out TEventMap extends EventMap> {
  bivarianceHack<
    TMap extends AnyEventMap<TEventMap>
  >(fn: ListenerRegistryForEachHandler<TMap>): void;
}

export type ListenerRegistryForEach<TEventMap extends EventMap> =
  ListenerRegistryForEachObject<TEventMap>['bivarianceHack'];

/**
 * Contravariant, map-like view of handlers keyed by event. Not a `ReadonlyMap` —
 * lookup keys are typed through the event map so a `Bus<Wide>` can satisfy
 * `SubscriptionSurface<Narrow>`. Iteration via {@link forEach} is typed at
 * compile time only; at runtime all registered keys are visited.
 */
export interface ListenerRegistry<TEventMap extends EventMap = EventMap> {
  get: ListenerRegistryGet<TEventMap>;

  getCount: ListenerRegistryGetCount<TEventMap>;

  forEach: ListenerRegistryForEach<TEventMap>;

  /** Number of non-empty buckets in this registry. */
  readonly size: number;
}

export class ListenerRegistryView<TEventMap extends EventMap> implements ListenerRegistry<TEventMap> {
  private readonly source: () => ReadonlyMap<EventKeys<TEventMap> | WILDCARD, ListenerSet>;

  public constructor(
    source: () => ReadonlyMap<EventKeys<TEventMap> | WILDCARD, ListenerSet>
  ) {
    this.source = source;
  }

  public static create<TEventMap extends EventMap>(
    source: () => ReadonlyMap<EventKeys<TEventMap> | WILDCARD, ListenerSet>
  ): ListenerRegistry<TEventMap> {
    return new ListenerRegistryView(source) as ListenerRegistry<TEventMap>;
  }

  public get: ListenerRegistryGet<TEventMap> = ((
    event
  ) => {
    return this.source().get(event);
  }) as ListenerRegistryGet<TEventMap>;

  public getCount: ListenerRegistryGetCount<TEventMap> = ((
    event
  ) => {
    return this.source().get(event)?.size ?? 0;
  }) as ListenerRegistryGetCount<TEventMap>;

  public forEach: ListenerRegistryForEach<TEventMap> = ((
    fn
  ) => {
    for(const [event, handlers] of this.source()) {
      if(handlers.size) {
        fn(handlers, event as EventListenerMapKey<TEventMap>);
      }
    }
  }) as ListenerRegistryForEach<TEventMap>;

  public get size(): number {
    let count = 0;
    for(const [, handlers] of this.source()) {
      if(handlers.size) {
        count++;
      }
    }
    return count;
  }
}
