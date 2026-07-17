import {autobind} from 'core-decorators';

import type {DownstreamManager} from './downstreamManager';
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
 * @ignore
 * Owns listener introspection caches, scope routing, and surplus-aware counts.
 */
@autobind
export class IntrospectionManager<TEventMap extends EventMap = EventMap> {
  private _cachedCombinedListeners: Map<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>>;
  private _cachedCombinedListenersWithIncognito: Map<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>>;
  private _cachedOwnListeners: Map<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>>;
  private _cachedOwnListenersWithIncognito: Map<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>>;
  private _cachedDownstreamListeners: Map<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>>;
  private _cachedDownstreamListenersWithIncognito: Map<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>>;

  private readonly listenersRegistry: ListenerRegistry<TEventMap>;
  private readonly listenersRegistryWithIncognito: ListenerRegistry<TEventMap>;
  private readonly ownListenersRegistry: ListenerRegistry<TEventMap>;
  private readonly ownListenersRegistryWithIncognito: ListenerRegistry<TEventMap>;
  private readonly downstreamListenersRegistry: ListenerRegistry<TEventMap>;
  private readonly downstreamListenersRegistryWithIncognito: ListenerRegistry<TEventMap>;

  private readonly subscriptions: SubscriptionManager<TEventMap>;
  private readonly downstream: DownstreamManager<TEventMap>;

  private static readonly _emptyListenersRegistry: ListenerRegistry<any> =
    ListenerRegistryView.create(() => new Map());

  constructor(params: {
    subscriptions: SubscriptionManager<TEventMap>;
    downstream: DownstreamManager<TEventMap>;
  }) {
    this.subscriptions = params.subscriptions;
    this.downstream = params.downstream;
    this.listenersRegistry = ListenerRegistryView.create(() => this.getCombinedListenersMap(false));
    this.listenersRegistryWithIncognito = ListenerRegistryView.create(() => this.getCombinedListenersMap(true));
    this.ownListenersRegistry = ListenerRegistryView.create(() => this.getOwnListenersMap(false));
    this.ownListenersRegistryWithIncognito = ListenerRegistryView.create(() => this.getOwnListenersMap(true));
    this.downstreamListenersRegistry = ListenerRegistryView.create(() => this.getDownstreamListenersMap(false));
    this.downstreamListenersRegistryWithIncognito = ListenerRegistryView.create(() => this.getDownstreamListenersMap(true));
  }

  public hasListeners(options: IntrospectionOptions = {}): boolean {
    return this.getListenerCount(options) > 0;
  }

  public getListenerCount(options: IntrospectionOptions = {}): number {
    const {scope = ListenerScope.ANY, includeIncognito = false} = options;
    if((scope & ListenerScope.ANY) === ListenerScope.ANY) {
      return this.getListenerCount({scope: ListenerScope.OWN, includeIncognito})
        + this.getListenerCount({scope: ListenerScope.DOWNSTREAM, includeIncognito});
    }
    let total = 0;
    this.registryForScope(scope, includeIncognito).forEach(handlers => {
      total += handlers.size;
    });
    if((scope & ListenerScope.OWN) === ListenerScope.OWN) {
      total += this.subscriptions.stackedSurplusTotal();
    }
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
    let count = this.registryForScope(scope, includeIncognito).getCount(event);
    if((scope & ListenerScope.OWN) === ListenerScope.OWN) {
      count += this.subscriptions.stackedSurplusFor(event);
    }
    return count;
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
      const listenerCache = new Map(this.getOwnListenersMap(includeIncognito));
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

  private registryForScope(scope: ListenerScope, includeIncognito = false): ListenerRegistry<TEventMap> {
    if((scope & ListenerScope.ANY) === ListenerScope.ANY) {
      return includeIncognito ? this.listenersRegistryWithIncognito : this.listenersRegistry;
    } else if((scope & ListenerScope.OWN) === ListenerScope.OWN) {
      return includeIncognito ? this.ownListenersRegistryWithIncognito : this.ownListenersRegistry;
    } else if((scope & ListenerScope.DOWNSTREAM) === ListenerScope.DOWNSTREAM) {
      return includeIncognito ? this.downstreamListenersRegistryWithIncognito : this.downstreamListenersRegistry;
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
      this.downstream.forEach(({getCombinedListenersMap, incognito}) => {
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
