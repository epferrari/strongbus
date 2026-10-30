import {autobind} from 'core-decorators';

import type {SubscriptionManager} from './subscriptionManager';
import type {EventMap, WILDCARD} from './types/events';
import type {GenericHandler} from './types/eventHandlers';
import {ListenerRegistryView, type ListenerRegistry, EMPTY_LISTENER_SET} from './types/listenerRegistry';
import {ListenerScope, type IntrospectionOptions} from './types/listenerScope';
import type {
  IntrospectionSurfaceHasListenersForEvent,
  IntrospectionSurfaceListenerCountForEvent,
  IntrospectionSurfaceListenerForEach,
  IntrospectionSurfaceListenerForEvent
} from './types/surfaces/introspectionSurface';
import type {EventKeys} from './types/utility';

/**
 * Pipe graph callbacks supplied to {@link IntrospectionManager}.
 * @internal
 */
export interface IntrospectionHost<TEventMap extends EventMap> {
  hasDownstream(): boolean;
  /**
   * Calls `fn` for each downstream reachable through an eligible edge (incognito edges only when
   * `includeIncognito`), stopping at the first call that returns `true`.
   * @returns whether `fn` returned `true`
   */
  someDownstream(
    includeIncognito: boolean,
    fn: (downstream: IntrospectionManager<TEventMap>) => boolean
  ): boolean;
  forEachDownstream(
    fn: (downstream: {
      getCombinedListenersMap(
        includeIncognito: boolean
      ): ReadonlyMap<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>>;
      incognito: boolean;
    }) => void
  ): void;
}

/**
 * Owns listener introspection caches, scope routing, and surplus-aware counts.
 * @internal
 */
@autobind
export class IntrospectionManager<TEventMap extends EventMap = EventMap> {
  private _cachedCombinedListeners: Map<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>>;
  private _cachedCombinedListenersWithIncognito: Map<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>>;
  private _cachedOwnListeners: Map<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>>;
  private _cachedOwnListenersWithIncognito: Map<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>>;
  private _cachedDownstreamListeners: Map<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>>;
  private _cachedDownstreamListenersWithIncognito: Map<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>>;

  private listenersRegistry?: ListenerRegistry<TEventMap>;
  private listenersRegistryWithIncognito?: ListenerRegistry<TEventMap>;
  private ownListenersRegistry?: ListenerRegistry<TEventMap>;
  private ownListenersRegistryWithIncognito?: ListenerRegistry<TEventMap>;
  private downstreamListenersRegistry?: ListenerRegistry<TEventMap>;
  private downstreamListenersRegistryWithIncognito?: ListenerRegistry<TEventMap>;

  private readonly subscriptions: SubscriptionManager<TEventMap>;
  private readonly host: IntrospectionHost<TEventMap>;

  private static readonly _emptyListenersRegistry: ListenerRegistry<any> =
    ListenerRegistryView.create(() => new Map());

  constructor(params: {
    subscriptions: SubscriptionManager<TEventMap>;
    host: IntrospectionHost<TEventMap>;
  }) {
    this.subscriptions = params.subscriptions;
    this.host = params.host;
  }

  public hasListeners(options: IntrospectionOptions = {}): boolean {
    const {scope = ListenerScope.ANY, includeIncognito = false} = options;
    if((scope & ListenerScope.ANY) === ListenerScope.ANY) {
      return this.hasListeners({scope: ListenerScope.OWN, includeIncognito})
        || this.hasListeners({scope: ListenerScope.DOWNSTREAM, includeIncognito});
    }
    if((scope & ListenerScope.OWN) === ListenerScope.OWN) {
      return this.getListenerCount(options) > 0;
    }
    // asking each downstream avoids rebuilding the listener maps, which would make every
    // removal on a bus with an upstream cost as much as the number of listeners it has
    return this.host.someDownstream(
      includeIncognito,
      (downstream) => downstream.hasListeners({scope: ListenerScope.ANY, includeIncognito})
    );
  }

  /**
   * {@link getListenerCount} with the default options, but stops counting at `cap`. For callers
   * that only need to tell none from one from several, without rebuilding the listener maps.
   */
  public getListenerCountUpTo(cap: number): number {
    return this.countUpTo(cap);
  }

  /** {@link getListenerCountFor} with the default options, but stops counting at `cap`. */
  public getListenerCountForUpTo(event: EventKeys<TEventMap>|WILDCARD, cap: number): number {
    return this.countUpTo(cap, event);
  }

  /**
   * Adds the distinct (event, handler) pairs this bus can be heard through, its own and its
   * downstreams', to `tally` until the tally is full. Incognito ones are left out.
   * With an `event`, only that event's pairs are added.
   * @internal
   */
  public tallyListeners(tally: ListenerTally<TEventMap>, event?: EventKeys<TEventMap>|WILDCARD): void {
    this.tallyOwnListeners(tally, event);
    if(!tally.full) {
      this.tallyDownstreamListeners(tally, event);
    }
  }

  private countUpTo(cap: number, event?: EventKeys<TEventMap>|WILDCARD): number {
    const own = event === undefined
      ? this.subscriptions.ownHandlerTotal(false) + this.subscriptions.stackedSurplusTotal()
      : this.subscriptions.ownHandlerCountFor(event, false) + this.subscriptions.stackedSurplusFor(event);
    if(own >= cap) {
      return cap;
    }
    const tally = new ListenerTally<TEventMap>(cap - own);
    this.tallyDownstreamListeners(tally, event);
    return own + tally.count;
  }

  private tallyOwnListeners(tally: ListenerTally<TEventMap>, event?: EventKeys<TEventMap>|WILDCARD): void {
    const visit = (key: EventKeys<TEventMap>|WILDCARD, handlers: ReadonlySet<GenericHandler>): void => {
      for(const handler of handlers) {
        if(!this.subscriptions.isIncognito(handler, key)) {
          tally.add(key, handler);
          if(tally.full) {
            return;
          }
        }
      }
    };
    if(event !== undefined) {
      const handlers = this.subscriptions.handlersFor(event);
      if(handlers) {
        visit(event, handlers);
      }
      return;
    }
    for(const [key, handlers] of this.subscriptions.handlersByEventEntries()) {
      visit(key, handlers);
      if(tally.full) {
        return;
      }
    }
  }

  private tallyDownstreamListeners(tally: ListenerTally<TEventMap>, event?: EventKeys<TEventMap>|WILDCARD): void {
    this.host.someDownstream(false, (downstream) => {
      downstream.tallyListeners(tally, event);
      return tally.full;
    });
  }

  public getListenerCount(options: IntrospectionOptions = {}): number {
    const {scope = ListenerScope.ANY, includeIncognito = false} = options;
    if((scope & ListenerScope.ANY) === ListenerScope.ANY) {
      return this.getListenerCount({scope: ListenerScope.OWN, includeIncognito})
        + this.getListenerCount({scope: ListenerScope.DOWNSTREAM, includeIncognito});
    }
    if((scope & ListenerScope.OWN) === ListenerScope.OWN) {
      return this.subscriptions.ownHandlerTotal(includeIncognito) + this.subscriptions.stackedSurplusTotal();
    }
    if(!this.host.hasDownstream()) {
      return 0;
    }
    let total = 0;
    this.registryForScope(scope, includeIncognito).forEach(handlers => {
      total += handlers.size;
    });
    return total;
  }

  public getListeners(options: IntrospectionOptions = {}): ReadonlySet<GenericHandler> {
    const {scope = ListenerScope.ANY, includeIncognito = false} = options;
    const union = new Set<GenericHandler>();
    this.registryForScope(scope, includeIncognito).forEach(handlers => {
      for(const handler of handlers) {
        union.add(handler);
      }
    });
    return union;
  }

  public getEventCount(options: IntrospectionOptions = {}): number {
    const {scope = ListenerScope.ANY, includeIncognito = false} = options;
    return this.registryForScope(scope, includeIncognito).size;
  }

  public hasListenersFor: IntrospectionSurfaceHasListenersForEvent<TEventMap> = ((
    event,
    options: IntrospectionOptions = {}
  ) => {
    return this.getListenerCountFor(event, options) > 0;
  }) as IntrospectionSurfaceHasListenersForEvent<TEventMap>;

  public getListenerCountFor: IntrospectionSurfaceListenerCountForEvent<TEventMap> = ((
    event,
    options: IntrospectionOptions = {}
  ) => {
    const {scope = ListenerScope.ANY, includeIncognito = false} = options;
    if((scope & ListenerScope.ANY) === ListenerScope.ANY) {
      return this.getListenerCountFor(event, {scope: ListenerScope.OWN, includeIncognito})
        + this.getListenerCountFor(event, {scope: ListenerScope.DOWNSTREAM, includeIncognito});
    }
    if((scope & ListenerScope.OWN) === ListenerScope.OWN) {
      return this.subscriptions.ownHandlerCountFor(event, includeIncognito)
        + this.subscriptions.stackedSurplusFor(event);
    }
    if(!this.host.hasDownstream()) {
      return 0;
    }
    return this.registryForScope(scope, includeIncognito).getCount(event);
  }) as IntrospectionSurfaceListenerCountForEvent<TEventMap>;

  public getListenersFor: IntrospectionSurfaceListenerForEvent<TEventMap> = ((
    event,
    options: IntrospectionOptions = {}
  ) => {
    const {scope = ListenerScope.ANY, includeIncognito = false} = options;
    return this.registryForScope(scope, includeIncognito).get(event) ?? EMPTY_LISTENER_SET;
  }) as IntrospectionSurfaceListenerForEvent<TEventMap>;

  public forEach: IntrospectionSurfaceListenerForEach<TEventMap> = ((
    fn,
    options: IntrospectionOptions = {}
  ) => {
    const {scope = ListenerScope.ANY, includeIncognito = false} = options;
    this.registryForScope(scope, includeIncognito).forEach((handlers, event) => {
      fn(event, handlers);
    });
  }) as IntrospectionSurfaceListenerForEach<TEventMap>;

  public getCombinedListenersMap(
    includeIncognito = false
  ): ReadonlyMap<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>> {
    const cached = includeIncognito
      ? this._cachedCombinedListenersWithIncognito
      : this._cachedCombinedListeners;
    if(!cached) {
      const listenerCache = new Map<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>>();
      // copy each set: merging downstream handlers into the own cache's sets would leak them into own scope
      for(const [event, listeners] of this.getOwnListenersMap(includeIncognito)) {
        listenerCache.set(event, new Set(listeners));
      }
      for(const [event, downstreamListeners] of this.getDownstreamListenersMap(includeIncognito)) {
        if(!downstreamListeners.size) {
          continue;
        }
        let listeners = listenerCache.get(event);
        if(!listeners) {
          listeners = new Set<GenericHandler>();
          listenerCache.set(event, listeners);
        }
        for(const listener of downstreamListeners) {
          (listeners as Set<any>).add(listener);
        }
      }
      if(includeIncognito) {
        this._cachedCombinedListenersWithIncognito = listenerCache;
      } else {
        this._cachedCombinedListeners = listenerCache;
      }
      return listenerCache;
    }
    return cached;
  }

  public invalidateCombinedListenerCache(): void {
    this._cachedCombinedListeners = null;
    this._cachedCombinedListenersWithIncognito = null;
    this._cachedDownstreamListeners = null;
    this._cachedDownstreamListenersWithIncognito = null;
  }

  public invalidateOwnListenerCache(): void {
    this._cachedOwnListeners = null;
    this._cachedOwnListenersWithIncognito = null;
  }

  /**
   * Views are only needed once something introspects, so each is built on first use rather
   * than for every bus.
   */
  private registryForScope(scope: ListenerScope, includeIncognito = false): ListenerRegistry<TEventMap> {
    if((scope & ListenerScope.ANY) === ListenerScope.ANY) {
      if(includeIncognito) {
        return this.listenersRegistryWithIncognito ??= ListenerRegistryView.create(() => this.getCombinedListenersMap(true));
      }
      return this.listenersRegistry ??= ListenerRegistryView.create(() => this.getCombinedListenersMap(false));
    } else if((scope & ListenerScope.OWN) === ListenerScope.OWN) {
      if(includeIncognito) {
        return this.ownListenersRegistryWithIncognito ??= ListenerRegistryView.create(() => this.getOwnListenersMap(true));
      }
      return this.ownListenersRegistry ??= ListenerRegistryView.create(() => this.getOwnListenersMap(false));
    } else if((scope & ListenerScope.DOWNSTREAM) === ListenerScope.DOWNSTREAM) {
      if(includeIncognito) {
        return this.downstreamListenersRegistryWithIncognito ??= ListenerRegistryView.create(() => this.getDownstreamListenersMap(true));
      }
      return this.downstreamListenersRegistry ??= ListenerRegistryView.create(() => this.getDownstreamListenersMap(false));
    }
    return IntrospectionManager._emptyListenersRegistry;
  }

  private getDownstreamListenersMap(
    includeIncognito = false
  ): ReadonlyMap<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>> {
    const cached = includeIncognito
      ? this._cachedDownstreamListenersWithIncognito
      : this._cachedDownstreamListeners;
    if(!cached) {
      const downstreamListenerCache = new Map<EventKeys<TEventMap>|WILDCARD, Set<GenericHandler>>();
      this.host.forEachDownstream(({getCombinedListenersMap, incognito}) => {
        if(incognito && !includeIncognito) {
          return;
        }
        for(const [event, listeners] of getCombinedListenersMap(includeIncognito)) {
          if(!listeners.size) {
            continue;
          }
          let merged = downstreamListenerCache.get(event);
          if(!merged) {
            merged = new Set<GenericHandler>();
            downstreamListenerCache.set(event, merged);
          }
          for(const listener of listeners) {
            merged.add(listener);
          }
        }
      });
      if(includeIncognito) {
        this._cachedDownstreamListenersWithIncognito = downstreamListenerCache;
      } else {
        this._cachedDownstreamListeners = downstreamListenerCache;
      }
      return downstreamListenerCache;
    }
    return cached;
  }

  private getOwnListenersMap(
    includeIncognito = false
  ): ReadonlyMap<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>> {
    const cached = includeIncognito
      ? this._cachedOwnListenersWithIncognito
      : this._cachedOwnListeners;
    if(!cached) {
      const ownListenerCache = new Map<EventKeys<TEventMap>|WILDCARD, Set<GenericHandler>>();
      for(const [event, listeners] of this.subscriptions.handlersByEventEntries()) {
        const filtered = includeIncognito
          ? new Set(listeners)
          : new Set([...listeners].filter(handler => !this.subscriptions.isIncognito(handler, event)));
        if(filtered.size) {
          ownListenerCache.set(event, filtered);
        }
      }
      if(includeIncognito) {
        this._cachedOwnListenersWithIncognito = ownListenerCache;
      } else {
        this._cachedOwnListeners = ownListenerCache;
      }
      return ownListenerCache;
    }
    return cached;
  }
}

/** Distinct (event, handler) pairs seen so far, which stops counting once it reaches `cap`. */
class ListenerTally<TEventMap extends EventMap> {
  public count = 0;
  private readonly seen = new Map<EventKeys<TEventMap>|WILDCARD, Set<GenericHandler>>();

  private readonly cap: number;

  constructor(cap: number) {
    this.cap = cap;
  }

  public get full(): boolean {
    return this.count >= this.cap;
  }

  public add(event: EventKeys<TEventMap>|WILDCARD, handler: GenericHandler): void {
    let handlers = this.seen.get(event);
    if(!handlers) {
      handlers = new Set<GenericHandler>();
      this.seen.set(event, handlers);
    }
    if(!handlers.has(handler)) {
      handlers.add(handler);
      this.count += 1;
    }
  }
}
