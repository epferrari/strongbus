import {type StrongbusLogger} from './strongbusLogger';
import type {MaterializedBusOptions} from './types/materializedBusOptions';
import {Lifecycle} from './types/lifecycle';
import type {GenericHandler} from './types/eventHandlers';
import type {EventMap, WILDCARD} from './types/events';
import type {MonitoringHook} from './types/surfaces/monitoringSurface';
import type {EventKeys} from './types/utility';
import {subscriptionWrapper} from './utils/subscriptionWrapper';
import {normalizeError} from './utils/normalizeError';
import {over} from './utils/over';

/** @internal Downstream listener counts captured when attaching/detaching a pipe edge. */
export type DownstreamSnapshotEntry<TEventMap extends EventMap> = {
  event: EventKeys<TEventMap>|WILDCARD;
  count: number;
};

/** @internal */
export type DownstreamSnapshot<TEventMap extends EventMap> = DownstreamSnapshotEntry<TEventMap>[];

/**
 * Bus bookkeeping callbacks supplied to {@link LifecycleManager}.
 * Shared resources (`logger`, `options`) are constructor deps, not host fields.
 * @internal
 */
export interface LifecycleHost<TEventMap extends EventMap> {
  hasListeners(): boolean;
  getListenerCount(): number;
  /** Like `getListenerCount`, but may stop counting at `cap`. */
  getListenerCountUpTo(cap: number): number;
  getOwnListenerCount(): number;
  /** The listener count for one event, which may stop counting at `cap`. */
  getListenerCountForUpTo(event: EventKeys<TEventMap>|WILDCARD, cap: number): number;
  accountForDownstreamListeners(event: EventKeys<TEventMap>|WILDCARD, count: number): void;
  accountForRemovedDownstreamListeners(event: EventKeys<TEventMap>|WILDCARD, count: number): void;
}

/**
 * Owns active/idle state and lifecycle hook dispatch for a {@link Bus}.
 * @internal
 */
export class LifecycleManager<TEventMap extends EventMap = EventMap> {
  private readonly handlers = new Map<Lifecycle, HandlerEntry>();
  private readonly host: LifecycleHost<TEventMap>;
  private readonly options: Pick<MaterializedBusOptions, 'coalesceDownstreamLifecycleEvents'>;
  private readonly logger: StrongbusLogger<TEventMap>;

  private _active = false;

  constructor(params: {
    host: LifecycleHost<TEventMap>;
    options: Pick<MaterializedBusOptions, 'coalesceDownstreamLifecycleEvents'>;
    logger: StrongbusLogger<TEventMap>;
  }) {
    this.host = params.host;
    this.options = params.options;
    this.logger = params.logger;
  }

  private get coalesceDownstreamLifecycleEvents(): boolean {
    return this.options.coalesceDownstreamLifecycleEvents;
  }

  public get active(): boolean {
    return this._active;
  }

  public hook: MonitoringHook<TEventMap> = ((
    event,
    handler
  ) => {
    addHandler(this.handlers, event, handler);
    return subscriptionWrapper(() => removeHandler(this.handlers, event, handler));
  }) as MonitoringHook<TEventMap>;

  public monitor(handler: (activeState: boolean) => void) {
    return subscriptionWrapper(over([
      this.hook(Lifecycle.active, () => handler(true)),
      this.hook(Lifecycle.idle, () => handler(false))
    ]));
  }

  public ownListenerWillAdd(event: EventKeys<TEventMap>|WILDCARD): void {
    if(!this._active) {
      this.emitLifecycleEvent(Lifecycle.willActivate, null);
    }
    this.emitLifecycleEvent(Lifecycle.willAddListener, event);
  }

  public ownListenerDidAdd(event: EventKeys<TEventMap>|WILDCARD): void {
    this.emitLifecycleEvent(Lifecycle.didAddListener, event);
    if(!this._active && this.host.hasListeners()) {
      this._active = true;
      this.emitLifecycleEvent(Lifecycle.active, null);
    }
  }

  public ownListenerWillRemove(event: EventKeys<TEventMap>|WILDCARD): void {
    // only none, one or several matters here, so counting stops at two
    const eventHandlerCount = this.host.getListenerCountForUpTo(event, 2);
    if(eventHandlerCount) {
      if(this._active && this.host.getListenerCountUpTo(2) === 1 && eventHandlerCount === 1) {
        this.emitLifecycleEvent(Lifecycle.willIdle, null);
      }
      this.emitLifecycleEvent(Lifecycle.willRemoveListener, event);
    }
  }

  public ownListenerDidRemove(event: EventKeys<TEventMap>|WILDCARD): void {
    this.emitLifecycleEvent(Lifecycle.didRemoveListener, event);
    if(this._active && !this.host.hasListeners()) {
      this._active = false;
      this.emitLifecycleEvent(Lifecycle.idle, null);
    }
  }

  public onDownstreamWillAdd(event: EventKeys<TEventMap>|WILDCARD): void {
    this.ownListenerWillAdd(event);
  }

  public onDownstreamDidAdd(event: EventKeys<TEventMap>|WILDCARD): void {
    this.host.accountForDownstreamListeners(event, 1);
    this.emitLifecycleEvent(Lifecycle.didAddListener, event);
    if(!this._active && this.host.hasListeners()) {
      this._active = true;
      this.emitLifecycleEvent(Lifecycle.active, null);
    }
  }

  public onDownstreamWillRemove(event: EventKeys<TEventMap>|WILDCARD): void {
    this.ownListenerWillRemove(event);
  }

  public onDownstreamDidRemove(event: EventKeys<TEventMap>|WILDCARD): void {
    this.host.accountForRemovedDownstreamListeners(event, 1);
    this.emitLifecycleEvent(Lifecycle.didRemoveListener, event);
    if(this._active && !this.host.hasListeners()) {
      this._active = false;
      this.emitLifecycleEvent(Lifecycle.idle, null);
    }
  }

  public onDownstreamAttached(snapshot: DownstreamSnapshot<TEventMap>): void {
    let total = 0;
    for(const {count} of snapshot) {
      total += count;
    }
    if(!total) {
      return;
    }

    const activationPending = !this._active;

    if(activationPending) {
      this.emitLifecycleEvent(Lifecycle.willActivate, null);
    }

    for(const {event, count} of snapshot) {
      const addEmissions = this.coalesceDownstreamLifecycleEvents ? 1 : count;
      const listenersPerAdd = this.coalesceDownstreamLifecycleEvents ? count : 1;

      for(let i = 0; i < addEmissions; i++) {
        this.emitLifecycleEvent(Lifecycle.willAddListener, event);
        this.host.accountForDownstreamListeners(event, listenersPerAdd);
        this.emitLifecycleEvent(Lifecycle.didAddListener, event);
        if(activationPending && !this._active && this.host.hasListeners()) {
          this._active = true;
          this.emitLifecycleEvent(Lifecycle.active, null);
        }
      }
    }
  }

  public onDownstreamDetached(snapshot: DownstreamSnapshot<TEventMap>): void {
    const ownTotal = this.host.getOwnListenerCount();
    let removalCount = 0;

    for(const {count} of snapshot) {
      removalCount += count;
    }

    if(!removalCount) {
      return;
    }

    const idlePending = this._active
      && ownTotal === 0
      && this.host.getListenerCount() === removalCount;

    let remaining = removalCount;

    for(const {event, count} of snapshot) {
      const removeEmissions = this.coalesceDownstreamLifecycleEvents ? 1 : count;
      const listenersPerRemove = this.coalesceDownstreamLifecycleEvents ? count : 1;

      for(let i = 0; i < removeEmissions; i++) {
        if(idlePending && remaining === listenersPerRemove) {
          this.emitLifecycleEvent(Lifecycle.willIdle, null);
        }
        this.emitLifecycleEvent(Lifecycle.willRemoveListener, event);
        this.host.accountForRemovedDownstreamListeners(event, listenersPerRemove);
        this.emitLifecycleEvent(Lifecycle.didRemoveListener, event);
        remaining -= listenersPerRemove;
        if(idlePending && remaining === 0) {
          this._active = false;
          this.emitLifecycleEvent(Lifecycle.idle, null);
        }
      }
    }
  }

  public emitHandlerError(
    error: unknown,
    event: EventKeys<TEventMap>|WILDCARD | Lifecycle
  ): void {
    this.emitLifecycleEvent(Lifecycle.error, {error: normalizeError(error), event});
  }

  public destroy(): void {
    this.emitLifecycleEvent(Lifecycle.willDestroy, null);
    this.handlers.clear();
  }

  private emitLifecycleEvent<L extends Lifecycle>(event: L, payload: Lifecycle.EventMap<TEventMap>[L]): void {
    const entry = this.handlers.get(event);
    if(typeof entry === 'function') {
      this.invokeLifecycleHandler(entry, event, payload);
    } else if(entry) {
      for(const fn of entry) {
        this.invokeLifecycleHandler(fn, event, payload);
      }
    }
  }

  private invokeLifecycleHandler<L extends Lifecycle>(
    fn: GenericHandler,
    event: L,
    payload: Lifecycle.EventMap<TEventMap>[L]
  ): void {
    try {
      const execution = fn(payload);

      (execution as Promise<any>)?.catch?.((e) => {
        if(event === Lifecycle.error) {
          const errorPayload = payload as Lifecycle.EventMap<TEventMap>['error'];
          this.logger.onAsyncErrorHandlerFailed({
              errorHandler: fn.name,
              errorHandlerError: e,
              originalEvent: errorPayload.event,
              eventHandlerError: errorPayload.error
          });
        } else {
          this.emitLifecycleEvent(Lifecycle.error, {error: e, event});
        }
      });
    } catch(e) {
      if(event === Lifecycle.error) {
        const errorPayload = payload as Lifecycle.EventMap<TEventMap>['error'];
        this.logger.onErrorHandlerFailed({
            errorHandler: fn.name,
            errorHandlerError: e,
            originalEvent: errorPayload.event,
            eventHandlerError: errorPayload.error
        });
      } else {
        this.emitLifecycleEvent(Lifecycle.error, {error: normalizeError(e), event});
      }
    }
  }
}

/** A lone handler is stored bare; a `Set` is only allocated once a second handler is added. */
type HandlerEntry = GenericHandler | Set<GenericHandler>;

function addHandler<TKey>(bus: Map<TKey, HandlerEntry>, event: TKey, handler: GenericHandler): void {
  if(!handler) {
    return;
  }
  const prev = bus.get(event);
  if(!prev) {
    bus.set(event, handler);
  } else if(typeof prev === 'function') {
    if(prev !== handler) {
      bus.set(event, new Set([prev, handler]));
    }
  } else {
    const next = new Set<GenericHandler>(prev);
    next.add(handler);
    bus.set(event, next);
  }
}

function removeHandler<TKey>(bus: Map<TKey, HandlerEntry>, event: TKey, handler: GenericHandler): void {
  const entry = bus.get(event);
  if(entry === handler) {
    bus.delete(event);
  } else if(entry && typeof entry !== 'function' && entry.delete(handler) && entry.size === 1) {
    const [remaining] = entry;
    bus.set(event, remaining);
  }
}
