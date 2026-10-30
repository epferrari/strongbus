import type {IntrospectionManager} from './introspectionManager';
import type {EventDispatcher} from './eventDispatcher';
import type {LifecycleHost} from './lifecycleManager';
import type {Bus} from './strongbus';
import type {EventMap, WILDCARD} from './types/events';
import {ListenerScope} from './types/listenerScope';
import type {EventKeys} from './types/utility';

/**
 * What a {@link Bus}'s managers need from it, as methods shared by every bus. Handing each
 * manager a literal of arrow functions would allocate those functions again for every bus.
 * @internal
 */
export class BusHost<TEventMap extends EventMap> implements
  IntrospectionManager.Graph<TEventMap>,
  EventDispatcher.Graph<TEventMap>,
  LifecycleHost<TEventMap> {
  private readonly bus: Bus<TEventMap>;

  constructor(bus: Bus<TEventMap>) {
    this.bus = bus;
  }

  public hasDownstream(): boolean {
    return this.bus.hasDownstream();
  }

  public someDownstream(
    includeIncognito: boolean,
    fn: (downstream: IntrospectionManager<TEventMap>) => boolean
  ): boolean {
    return this.bus.someDownstream(includeIncognito, fn);
  }

  public forEachDownstream(
    fn: Parameters<IntrospectionManager.Graph<TEventMap>['forEachDownstream']>[0]
  ): void {
    this.bus.forEachDownstream(fn);
  }

  public propagate<T extends EventKeys<TEventMap>>(
    event: T,
    payload: TEventMap[T] | undefined,
    fromUpstream: boolean
  ): boolean {
    return this.bus.propagate(event, payload, fromUpstream);
  }

  public hasListeners(): boolean {
    return this.bus.hasListeners();
  }

  public getListenerCount(): number {
    return this.bus.getListenerCount();
  }

  public getListenerCountUpTo(cap: number): number {
    return this.bus.introspection.getListenerCountUpTo(cap);
  }

  public getOwnListenerCount(): number {
    return this.bus.getListenerCount({scope: ListenerScope.OWN});
  }

  public getListenerCountForUpTo(event: EventKeys<TEventMap>|WILDCARD, cap: number): number {
    return this.bus.introspection.getListenerCountForUpTo(event, cap);
  }

  // local invalidation is enough here: the bus where the change started has already walked
  // every upstream, this one included
  public accountForDownstreamListeners(_event: EventKeys<TEventMap>|WILDCARD, _count: number): void {
    this.bus.introspection.invalidateCombinedListenerCache();
  }

  public accountForRemovedDownstreamListeners(_event: EventKeys<TEventMap>|WILDCARD, _count: number): void {
    this.bus.introspection.invalidateCombinedListenerCache();
  }
}
