import {autobind} from 'core-decorators';

import {
  type DownstreamSnapshot,
  type LifecycleManager
} from './lifecycleManager';
import type {EventMap, WILDCARD} from './types/events';
import type {GenericHandler} from './types/eventHandlers';
import {Lifecycle} from './types/lifecycle';
import type {MonitoringHook} from './types/surfaces/monitoringSurface';
import type {SubscribeOptions} from './types/surfaces/subscriptionSurface';
import type {EventKeys} from './types/utility';
import {over} from './utils/over';

/**
 * Minimal surface of a bus that can be piped to.
 * Avoids importing {@link Bus} (circular).
 * @internal
 */
export type DownstreamTarget<TEventMap extends EventMap> = {
  hook: MonitoringHook<TEventMap>;
  emit(event: any, payload?: any): boolean;
};

/**
 * Bus bookkeeping callbacks supplied to {@link DownstreamManager}.
 * Shared resources (`lifecycle`) are constructor deps, not host fields.
 * @internal
 */
export type DownstreamHost<TEventMap extends EventMap> = {
  is(target: DownstreamTarget<TEventMap>): boolean;
  getCombinedListenersMap(
    target: DownstreamTarget<TEventMap>,
    includeIncognito: boolean
  ): ReadonlyMap<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>>;
  invalidateCombinedListenerCache(): void;
};

/**
 * @ignore
 * Owns bus-to-bus pipe links, lifecycle bridging, and emit propagation.
 */
@autobind
export class DownstreamManager<TEventMap extends EventMap = EventMap> {
  private readonly links = new Map<DownstreamTarget<TEventMap>, {
    unlink: VoidFunction;
    incognito: boolean;
  }>();

  private readonly host: DownstreamHost<TEventMap>;
  private readonly lifecycle: LifecycleManager<TEventMap>;

  constructor(params: {
    host: DownstreamHost<TEventMap>;
    lifecycle: LifecycleManager<TEventMap>;
  }) {
    this.host = params.host;
    this.lifecycle = params.lifecycle;
  }

  public pipe(
    downstream: DownstreamTarget<TEventMap>,
    options?: SubscribeOptions
  ): DownstreamTarget<TEventMap> {
    if(this.host.is(downstream)) {
      return downstream;
    }
    if(this.links.has(downstream)) {
      return downstream;
    }

    const incognito = options?.incognito === true;
    if(incognito) {
      this.links.set(downstream, {
        unlink: () => undefined,
        incognito: true
      });
    } else {
      this.links.set(downstream, {
        unlink: over([
          downstream.hook(Lifecycle.willAddListener, (event) =>
            this.lifecycle.onDownstreamWillAdd(event as EventKeys<TEventMap>|WILDCARD)),
          downstream.hook(Lifecycle.didAddListener, (event) =>
            this.lifecycle.onDownstreamDidAdd(event as EventKeys<TEventMap>|WILDCARD)),
          downstream.hook(Lifecycle.willRemoveListener, (event) =>
            this.lifecycle.onDownstreamWillRemove(event as EventKeys<TEventMap>|WILDCARD)),
          downstream.hook(Lifecycle.didRemoveListener, (event) =>
            this.lifecycle.onDownstreamDidRemove(event as EventKeys<TEventMap>|WILDCARD))
        ]),
        incognito: false
      });
      this.lifecycle.onDownstreamAttached(this.buildSnapshot(downstream));
    }
    this.host.invalidateCombinedListenerCache();
    return downstream;
  }

  public unpipe(downstream: DownstreamTarget<TEventMap>): void {
    const link = this.links.get(downstream);
    if(!link) {
      return;
    }
    if(!link.incognito) {
      this.lifecycle.onDownstreamDetached(this.buildSnapshot(downstream));
    }
    link.unlink();
    this.links.delete(downstream);
    this.host.invalidateCombinedListenerCache();
  }

  public propagate<T extends EventKeys<TEventMap>>(
    event: T,
    payload?: TEventMap[T]
  ): boolean {
    let handled = false;
    for(const d of this.links.keys()) {
      handled = d.emit(event as any, payload as any) || handled;
    }
    return handled;
  }

  public releaseAll(): void {
    for(const link of this.links.values()) {
      link.unlink();
    }
    this.links.clear();
  }

  public forEach(
    fn: (downstream: {
      getCombinedListenersMap(
        includeIncognito: boolean
      ): ReadonlyMap<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>>;
      incognito: boolean;
    }) => void
  ): void {
    for(const [target, link] of this.links) {
      fn({
        getCombinedListenersMap: (includeIncognito) =>
          this.host.getCombinedListenersMap(target, includeIncognito),
        incognito: link.incognito
      });
    }
  }

  private buildSnapshot(downstream: DownstreamTarget<TEventMap>): DownstreamSnapshot<TEventMap> {
    return DownstreamManager.snapshotFromListenersMap(
      this.host.getCombinedListenersMap(downstream, false)
    );
  }

  private static snapshotFromListenersMap<TEventMap extends EventMap>(
    listeners: ReadonlyMap<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>>
  ): DownstreamSnapshot<TEventMap> {
    const snapshot: DownstreamSnapshot<TEventMap> = [];
    for(const [event, handlers] of listeners) {
      if(!handlers.size) {
        continue;
      }
      snapshot.push({event, count: handlers.size});
    }
    return snapshot;
  }
}
