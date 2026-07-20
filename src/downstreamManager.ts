import {autobind} from 'core-decorators';

import {
  type DownstreamSnapshot,
  type LifecycleManager
} from './lifecycleManager';
import {StrongbusLogMessages, type StrongbusLogger} from './strongbusLogger';
import type {EventMap, WILDCARD} from './types/events';
import type {GenericHandler, PipedMessage, PipePredicate} from './types/eventHandlers';
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
  readonly name: string;
  hook: MonitoringHook<TEventMap>;
  /** Accept an upstream-sourced event into this bus's dispatcher. */
  acceptFromUpstream(event: any, payload?: any): boolean;
  noteInboundPipeAttached(source: DownstreamTarget<TEventMap>): void;
  noteInboundPipeDetached(source: DownstreamTarget<TEventMap>): void;
};

export type DownstreamLinkOptions<TEventMap extends EventMap> = SubscribeOptions & {
  filter?: PipePredicate<TEventMap>;
};

/**
 * Bus bookkeeping callbacks supplied to {@link DownstreamManager}.
 * Shared resources (`lifecycle`, `logger`) are constructor deps, not host fields.
 * @internal
 */
export type DownstreamHost<TEventMap extends EventMap> = {
  is(target: DownstreamTarget<TEventMap>): boolean;
  /** This bus as a {@link DownstreamTarget}, for inbound bookkeeping on peers. */
  asTarget(): DownstreamTarget<TEventMap>;
  get name(): string;
  getCombinedListenersMap(
    target: DownstreamTarget<TEventMap>,
    includeIncognito: boolean
  ): ReadonlyMap<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>>;
  invalidateCombinedListenerCache(): void;
};

type LinkRecord<TEventMap extends EventMap> = {
  unlink: VoidFunction;
  incognito: boolean;
  filter?: PipePredicate<TEventMap>;
};

/**
 * @ignore
 * Owns bus-to-bus pipe links, lifecycle bridging, emit propagation, and multi-hop filters.
 */
@autobind
export class DownstreamManager<TEventMap extends EventMap = EventMap> {
  private readonly links = new Map<DownstreamTarget<TEventMap>, LinkRecord<TEventMap>>();
  private readonly inboundPeers = new Set<DownstreamTarget<TEventMap>>();
  /** Live unsound `source → this → dest` paths that have already been warned. */
  private readonly warnedUnsoundPaths = new Map<
    DownstreamTarget<TEventMap>,
    Set<DownstreamTarget<TEventMap>>
  >();

  private readonly host: DownstreamHost<TEventMap>;
  private readonly lifecycle: LifecycleManager<TEventMap>;
  private readonly logger: StrongbusLogger<TEventMap>;

  constructor(params: {
    host: DownstreamHost<TEventMap>;
    lifecycle: LifecycleManager<TEventMap>;
    logger: StrongbusLogger<TEventMap>;
  }) {
    this.host = params.host;
    this.lifecycle = params.lifecycle;
    this.logger = params.logger;
  }

  public get hasInbound(): boolean {
    return this.inboundPeers.size > 0;
  }

  public noteInboundAttached(source: DownstreamTarget<TEventMap>): void {
    if(this.inboundPeers.has(source)) {
      return;
    }
    this.inboundPeers.add(source);
    for(const [dest, link] of this.links) {
      if(!link.filter) {
        this.warnUnsoundPath(source, dest);
      }
    }
  }

  public noteInboundDetached(source: DownstreamTarget<TEventMap>): void {
    if(!this.inboundPeers.has(source)) {
      return;
    }
    const warnedDests = this.warnedUnsoundPaths.get(source);
    if(warnedDests) {
      for(const dest of warnedDests) {
        this.infoResolvedUnsoundPath(source, dest);
      }
      this.warnedUnsoundPaths.delete(source);
    }
    this.inboundPeers.delete(source);
  }

  public pipe(
    downstream: DownstreamTarget<TEventMap>,
    options?: DownstreamLinkOptions<TEventMap>
  ): DownstreamTarget<TEventMap> {
    if(this.host.is(downstream)) {
      return downstream;
    }
    if(this.links.has(downstream)) {
      const existing = this.links.get(downstream);
      if(existing && !existing.filter && options?.filter) {
        this.logger.warn(StrongbusLogMessages.unsoundPipeEdgeFilterUpgrade(
          this.host.name,
          downstream.name
        ));
      }
      return downstream;
    }

    const filter = options?.filter;
    const incognito = options?.incognito === true;
    if(incognito) {
      this.links.set(downstream, {
        unlink: () => undefined,
        incognito: true,
        filter
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
        incognito: false,
        filter
      });
      this.lifecycle.onDownstreamAttached(this.buildSnapshot(downstream));
    }
    downstream.noteInboundPipeAttached(this.host.asTarget());
    this.host.invalidateCombinedListenerCache();
    if(!filter) {
      for(const source of this.inboundPeers) {
        this.warnUnsoundPath(source, downstream);
      }
    }
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
    downstream.noteInboundPipeDetached(this.host.asTarget());
    this.resolveWarnedPathsTo(downstream);
    this.host.invalidateCombinedListenerCache();
  }

  /**
   * @param fromUpstream - true when *this* bus is dispatching an event it received via pipe
   */
  public propagate<T extends EventKeys<TEventMap>>(
    event: T,
    payload: TEventMap[T] | undefined,
    fromUpstream: boolean
  ): boolean {
    let handled = false;
    for(const [downstream, link] of this.links) {
      if(fromUpstream) {
        if(!link.filter) {
          continue;
        }
        const message = {event, payload} as PipedMessage<TEventMap>;
        if(!link.filter(message)) {
          continue;
        }
      }
      handled = downstream.acceptFromUpstream(event as any, payload as any) || handled;
    }
    return handled;
  }

  public releaseAll(): void {
    const self = this.host.asTarget();
    for(const [downstream, link] of this.links) {
      link.unlink();
      downstream.noteInboundPipeDetached(self);
      this.resolveWarnedPathsTo(downstream);
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

  private warnUnsoundPath(
    source: DownstreamTarget<TEventMap>,
    dest: DownstreamTarget<TEventMap>
  ): void {
    let warnedDests = this.warnedUnsoundPaths.get(source);
    if(!warnedDests) {
      warnedDests = new Set();
      this.warnedUnsoundPaths.set(source, warnedDests);
    }
    if(warnedDests.has(dest)) {
      return;
    }
    warnedDests.add(dest);
    this.logger.warn(StrongbusLogMessages.unsoundPipeGraph(
      this.host.name,
      source.name,
      dest.name
    ));
  }

  private resolveWarnedPathsTo(dest: DownstreamTarget<TEventMap>): void {
    for(const source of this.inboundPeers) {
      const warnedDests = this.warnedUnsoundPaths.get(source);
      if(!warnedDests?.has(dest)) {
        continue;
      }
      warnedDests.delete(dest);
      if(!warnedDests.size) {
        this.warnedUnsoundPaths.delete(source);
      }
      this.infoResolvedUnsoundPath(source, dest);
    }
  }

  private infoResolvedUnsoundPath(
    source: DownstreamTarget<TEventMap>,
    dest: DownstreamTarget<TEventMap>
  ): void {
    this.logger.info(StrongbusLogMessages.unsoundPipeGraphResolved(
      this.host.name,
      source.name,
      dest.name
    ));
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
