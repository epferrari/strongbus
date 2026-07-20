import {autobind} from 'core-decorators';

import {
  type DownstreamSnapshot,
  type LifecycleManager
} from './lifecycleManager';
import {StrongbusLogMessages, type StrongbusLogger} from './strongbusLogger';
import type {EventMap, WILDCARD} from './types/events';
import type {GenericHandler, PipeMessage, PipePredicate} from './types/eventHandlers';
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
  /** Deliver an upstream-sourced event into this bus's dispatcher. */
  deliverFromUpstream(event: any, payload?: any): boolean;
  noteInboundPipeAttached(): void;
  noteInboundPipeDetached(): void;
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
  private inboundPipeCount: number = 0;
  private warnedUnsoundPipeGraph: boolean = false;

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
    return this.inboundPipeCount > 0;
  }

  public noteInboundAttached(): void {
    this.inboundPipeCount++;
  }

  public noteInboundDetached(): void {
    this.inboundPipeCount = Math.max(0, this.inboundPipeCount - 1);
  }

  public pipe(
    downstream: DownstreamTarget<TEventMap>,
    options?: DownstreamLinkOptions<TEventMap>
  ): DownstreamTarget<TEventMap> {
    if(this.host.is(downstream)) {
      return downstream;
    }
    if(this.links.has(downstream)) {
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
    downstream.noteInboundPipeAttached();
    this.host.invalidateCombinedListenerCache();
    this.maybeWarnUnsoundEdge(filter);
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
    downstream.noteInboundPipeDetached();
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
        const message = {event, payload} as PipeMessage<TEventMap>;
        if(!link.filter(message)) {
          continue;
        }
      }
      handled = downstream.deliverFromUpstream(event as any, payload as any) || handled;
    }
    return handled;
  }

  public releaseAll(): void {
    for(const [downstream, link] of this.links) {
      link.unlink();
      downstream.noteInboundPipeDetached();
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

  private maybeWarnUnsoundEdge(filter: PipePredicate<TEventMap> | undefined): void {
    if(filter || this.warnedUnsoundPipeGraph || !this.hasInbound) {
      return;
    }
    this.warnedUnsoundPipeGraph = true;
    this.logger.warn(StrongbusLogMessages.unsoundPipeGraph(this.host.name));
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
