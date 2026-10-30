import {autobind} from 'core-decorators';

import type {EventDispatcher} from './eventDispatcher';
import type {IntrospectionManager} from './introspectionManager';
import {
  type DownstreamSnapshot,
  type LifecycleManager
} from './lifecycleManager';
import {type StrongbusLogger} from './strongbusLogger';
import type {EventMap, WILDCARD} from './types/events';
import type {GenericHandler, PipedMessage, PipePredicate} from './types/eventHandlers';
import {Lifecycle} from './types/lifecycle';
import type {MaterializedBusOptions} from './types/materializedBusOptions';
import type {MonitoringHook} from './types/surfaces/monitoringSurface';
import type {SubscribeOptions} from './types/surfaces/subscriptionSurface';
import type {EventKeys} from './types/utility';
import {over} from './utils/over';

/** @internal Options for attaching a pipe graph edge. */
export type DownstreamLinkOptions<TEventMap extends EventMap> = SubscribeOptions & {
  filter?: PipePredicate<TEventMap>;
};

type BusNodeEdge<TEventMap extends EventMap> = {
  unlink: VoidFunction;
  incognito: boolean;
  filter?: PipePredicate<TEventMap>;
};

/**
 * Pure graph maps for pipe edges. Does not call peers or collaborators.
 */
class PipeGraphState<TEventMap extends EventMap> {
  public readonly upstreams = new Set<BusGraphNode<TEventMap>>();
  public readonly downstreams = new Map<BusGraphNode<TEventMap>, BusNodeEdge<TEventMap>>();
  /** Live unsound `source → this → dest` paths that have already been warned. */
  public readonly warnedUnsoundPaths = new Map<
    BusGraphNode<TEventMap>,
    Set<BusGraphNode<TEventMap>>
  >();
}

/**
 * @internal
 * Base for {@link Bus}: owns the pipe graph and peer delivery via `protected`
 * methods so graph helpers are not part of the public `Bus` surface.
 */
@autobind
export abstract class BusGraphNode<TEventMap extends EventMap = EventMap> {
  private readonly graph = new PipeGraphState<TEventMap>();

  protected abstract readonly options: MaterializedBusOptions;
  protected abstract readonly logger: StrongbusLogger<TEventMap>;
  protected abstract readonly lifecycle: LifecycleManager<TEventMap>;
  protected abstract readonly dispatcher: EventDispatcher<TEventMap>;
  protected abstract readonly introspection: IntrospectionManager<TEventMap>;

  /**
   * Subscribe to meta changes. Provided by {@link Bus} after lifecycle setup.
   */
  public abstract readonly hook: MonitoringHook<TEventMap>;

  public abstract readonly name: string;

  /**
   * Attach a graph edge to another node.
   */
  protected connectDownstreamNode(
    node: BusGraphNode<any>,
    options?: DownstreamLinkOptions<TEventMap>
  ): BusGraphNode<any> {
    if(node === this) {
      return node;
    }
    const {downstreams, upstreams} = this.graph;
    const downstream = node as BusGraphNode<TEventMap>;
    if(downstreams.has(downstream)) {
      const existing = downstreams.get(downstream);
      if(existing && !existing.filter && options?.filter) {
        this.logger.onUnsoundPipeEdgeFilterUpgrade(downstream.name);
      }
      return node;
    }

    if(downstream.hasDownstreamPathTo(this)) {
      this.logger.onCyclicPipe(downstream.name);
      return node;
    }

    const filter = options?.filter;
    const incognito = options?.incognito === true;
    if(incognito) {
      downstreams.set(downstream, {
        unlink: () => undefined,
        incognito: true,
        filter
      });
    } else {
      downstreams.set(downstream, {
        unlink: over([
          downstream.lifecycle.hook(Lifecycle.willAddListener, (event) =>
            this.lifecycle.onDownstreamWillAdd(event as EventKeys<TEventMap>|WILDCARD)),
          downstream.lifecycle.hook(Lifecycle.didAddListener, (event) =>
            this.lifecycle.onDownstreamDidAdd(event as EventKeys<TEventMap>|WILDCARD)),
          downstream.lifecycle.hook(Lifecycle.willRemoveListener, (event) =>
            this.lifecycle.onDownstreamWillRemove(event as EventKeys<TEventMap>|WILDCARD)),
          downstream.lifecycle.hook(Lifecycle.didRemoveListener, (event) =>
            this.lifecycle.onDownstreamDidRemove(event as EventKeys<TEventMap>|WILDCARD))
        ]),
        incognito: false,
        filter
      });
      this.lifecycle.onDownstreamAttached(this.buildSnapshot(downstream));
    }
    downstream.onConnectedAsDownstreamNode(this);
    this.invalidateListenerCachesUpstream();
    if(!filter) {
      for(const upstream of upstreams) {
        this.warnUnsoundPath(upstream, downstream);
      }
    }
    return node;
  }

  /**
   * Remove a previously attached graph edge.
   */
  protected disconnectDownstreamNode(node: BusGraphNode<any>): void {
    const downstream = node as BusGraphNode<TEventMap>;
    const edge = this.graph.downstreams.get(downstream);
    if(!edge) {
      return;
    }
    if(!edge.incognito) {
      this.lifecycle.onDownstreamDetached(this.buildSnapshot(downstream));
    }
    edge.unlink();
    this.graph.downstreams.delete(downstream);
    downstream.onDisconnectedAsDownstreamNode(this);
    this.resolveWarnedPathsTo(downstream);
    this.invalidateListenerCachesUpstream();
  }

  /**
   * @param fromUpstream - true when *this* node is dispatching an event it received via pipe
   */
  protected propagate<T extends EventKeys<TEventMap>>(
    event: T,
    payload: TEventMap[T] | undefined,
    fromUpstream: boolean
  ): boolean {
    let handled = false;
    for(const [downstream, edge] of this.graph.downstreams) {
      if(fromUpstream) {
        if(!edge.filter) {
          continue;
        }
        const message = {event, payload} as PipedMessage<TEventMap>;
        if(!edge.filter(message)) {
          continue;
        }
      }
      handled = downstream.acceptFromUpstream(event as any, payload as any) || handled;
    }
    return handled;
  }

  protected releaseAllDownstreamEdges(): void {
    for(const [downstream, edge] of this.graph.downstreams) {
      edge.unlink();
      downstream.onDisconnectedAsDownstreamNode(this);
      this.resolveWarnedPathsTo(downstream);
    }
    this.graph.downstreams.clear();
    this.invalidateListenerCachesUpstream();
  }

  /**
   * Drops the cached combined listener maps of this node and of every node upstream of it. Call it
   * whenever this node's own listeners or downstream edges change, including incognito ones,
   * which never reach an upstream through lifecycle hooks.
   */
  protected invalidateListenerCachesUpstream(): void {
    this.introspection.invalidateCombinedListenerCache();
    if(!this.graph.upstreams.size) {
      return;
    }
    // `visited` keeps a diamond from being walked twice and a cycle from being walked forever
    const visited = new Set<BusGraphNode<TEventMap>>([this]);
    const pending: BusGraphNode<TEventMap>[] = [...this.graph.upstreams];
    while(pending.length) {
      const node = pending.pop();
      if(visited.has(node)) {
        continue;
      }
      visited.add(node);
      node.introspection.invalidateCombinedListenerCache();
      for(const upstream of node.graph.upstreams) {
        pending.push(upstream);
      }
    }
  }

  /**
   * Disconnect every downstream via {@link BusGraphNode.disconnectDownstreamNode}, so
   * this node's lifecycle and listener accounting see each removal.
   */
  protected disconnectAllDownstreamNodes(includeIncognito: boolean = true): void {
    for(const [downstream, edge] of [...this.graph.downstreams]) {
      if(includeIncognito || !edge.incognito) {
        this.disconnectDownstreamNode(downstream);
      }
    }
  }

  /**
   * Have every upstream drop its edge to this node.
   * @param includeIncognito - when `false`, upstreams that pipe in incognito keep their edge
   */
  protected releaseAllUpstreamEdges(includeIncognito: boolean = true): void {
    for(const upstream of [...this.graph.upstreams]) {
      if(includeIncognito || !upstream.graph.downstreams.get(this)?.incognito) {
        upstream.disconnectDownstreamNode(this);
      }
    }
  }

  protected hasDownstream(): boolean {
    return this.graph.downstreams.size > 0;
  }

  protected someDownstream(
    includeIncognito: boolean,
    fn: (downstream: IntrospectionManager<TEventMap>) => boolean
  ): boolean {
    for(const [downstream, edge] of this.graph.downstreams) {
      if(edge.incognito && !includeIncognito) {
        continue;
      }
      if(fn(downstream.introspection)) {
        return true;
      }
    }
    return false;
  }

  protected forEachDownstream(
    fn: (downstream: {
      getCombinedListenersMap(
        includeIncognito: boolean
      ): ReadonlyMap<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>>;
      incognito: boolean;
    }) => void
  ): void {
    for(const [downstream, edge] of this.graph.downstreams) {
      fn({
        getCombinedListenersMap: (includeIncognito) =>
          downstream.getCombinedListenersMap(includeIncognito),
        incognito: edge.incognito
      });
    }
  }

  /**
   * Accept an event received via an upstream pipe edge.
   */
  protected acceptFromUpstream(event: any, payload?: any): boolean {
    return this.dispatcher.dispatchEvent(event, payload, true);
  }

  /**
   * Called when another node attaches an inbound pipe to this instance.
   */
  protected onConnectedAsDownstreamNode(node: BusGraphNode<TEventMap>): void {
    const {upstreams, downstreams} = this.graph;
    if(upstreams.has(node)) {
      return;
    }
    upstreams.add(node);
    for(const [downstream, edge] of downstreams) {
      if(!edge.filter) {
        this.warnUnsoundPath(node, downstream);
      }
    }
  }

  /**
   * Called when an inbound pipe to this instance is removed.
   */
  protected onDisconnectedAsDownstreamNode(node: BusGraphNode<TEventMap>): void {
    const {upstreams, warnedUnsoundPaths} = this.graph;
    if(!upstreams.has(node)) {
      return;
    }
    const warnedDests = warnedUnsoundPaths.get(node);
    if(warnedDests) {
      for(const dest of warnedDests) {
        this.infoResolvedUnsoundPath(node, dest);
      }
      warnedUnsoundPaths.delete(node);
    }
    upstreams.delete(node);
  }

  protected getCombinedListenersMap(
    includeIncognito = false
  ): ReadonlyMap<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>> {
    return this.introspection.getCombinedListenersMap(includeIncognito);
  }

  private warnUnsoundPath(
    source: BusGraphNode<TEventMap>,
    dest: BusGraphNode<TEventMap>
  ): void {
    let warnedDests = this.graph.warnedUnsoundPaths.get(source);
    if(!warnedDests) {
      warnedDests = new Set();
      this.graph.warnedUnsoundPaths.set(source, warnedDests);
    }
    if(warnedDests.has(dest)) {
      return;
    }
    warnedDests.add(dest);
    this.logger.onUnsoundPipeGraph(source.name, dest.name);
  }

  private resolveWarnedPathsTo(dest: BusGraphNode<TEventMap>): void {
    for(const source of this.graph.upstreams) {
      const warnedDests = this.graph.warnedUnsoundPaths.get(source);
      if(!warnedDests?.has(dest)) {
        continue;
      }
      warnedDests.delete(dest);
      if(!warnedDests.size) {
        this.graph.warnedUnsoundPaths.delete(source);
      }
      this.infoResolvedUnsoundPath(source, dest);
    }
  }

  private infoResolvedUnsoundPath(
    source: BusGraphNode<TEventMap>,
    dest: BusGraphNode<TEventMap>
  ): void {
    this.logger.onUnsoundPipeGraphResolved(source.name, dest.name);
  }

  private buildSnapshot(downstream: BusGraphNode<TEventMap>): DownstreamSnapshot<TEventMap> {
    return snapshotFromListenersMap(downstream.getCombinedListenersMap(false));
  }

  /**
   * Whether `target` is reachable from this node by following downstream edges, incognito ones
   * included. Iterative, so a long chain cannot overflow the stack.
   */
  private hasDownstreamPathTo(target: BusGraphNode<TEventMap>): boolean {
    const visited = new Set<BusGraphNode<TEventMap>>();
    const pending: BusGraphNode<TEventMap>[] = [this];
    while(pending.length) {
      const node = pending.pop();
      if(node === target) {
        return true;
      }
      if(visited.has(node)) {
        continue;
      }
      visited.add(node);
      for(const next of node.graph.downstreams.keys()) {
        pending.push(next);
      }
    }
    return false;
  }
}

function snapshotFromListenersMap<TEventMap extends EventMap>(
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
