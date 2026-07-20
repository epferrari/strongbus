import {autobind} from 'core-decorators';

import {type StrongbusLogger} from './strongbusLogger';
import type {MaterializedBusOptions} from './types/options';
import {Lifecycle} from './types/lifecycle';
import type {GenericHandler} from './types/eventHandlers';
import type {EventMap, WILDCARD} from './types/events';
import type {MonitoringHook} from './types/surfaces/monitoringSurface';
import type {EventKeys} from './types/utility';
import {subscriptionWrapper} from './utils/subscriptionWrapper';
import {normalizeError} from './utils/normalizeError';
import {over} from './utils/over';

export type DownstreamSnapshotEntry<TEventMap extends EventMap> = {
  event: EventKeys<TEventMap>|WILDCARD;
  count: number;
};

export type DownstreamSnapshot<TEventMap extends EventMap> = DownstreamSnapshotEntry<TEventMap>[];

/**
 * Bus bookkeeping callbacks supplied to {@link LifecycleManager}.
 * Shared resources (`logger`, `options`) are constructor deps, not host fields.
 * @internal
 */
export interface LifecycleHost<TEventMap extends EventMap> {
  hasListeners(): boolean;
  getListenerCount(): number;
  getOwnListenerCount(): number;
  getListenerCountFor(event: EventKeys<TEventMap>|WILDCARD): number;
  accountForDownstreamListeners(event: EventKeys<TEventMap>|WILDCARD, count: number): void;
  accountForRemovedDownstreamListeners(event: EventKeys<TEventMap>|WILDCARD, count: number): void;
}

@autobind
export class LifecycleManager<TEventMap extends EventMap = EventMap> {
  private readonly handlers = new Map<Lifecycle, Set<GenericHandler>>();
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
    const eventHandlerCount = this.host.getListenerCountFor(event);
    if(eventHandlerCount) {
      if(this._active && this.host.getListenerCount() === 1 && eventHandlerCount === 1) {
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
    const handlers = this.handlers.get(event);
    if(handlers && handlers.size) {
      for(const fn of handlers) {
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
  }
}

function addHandler<TKey>(bus: Map<TKey, Set<GenericHandler>>, event: TKey, handler: GenericHandler): void {
  if(!handler) {
    return;
  }
  const prevSet = bus.get(event);
  const newSet = new Set<GenericHandler>(prevSet);
  newSet.add(handler);
  bus.set(event, newSet);
}

function removeHandler<TKey>(bus: Map<TKey, Set<GenericHandler>>, event: TKey, handler: GenericHandler): void {
  const set = bus.get(event);
  if(!set) {
    return;
  }
  set.delete(handler);
  if(set.size === 0) {
    bus.delete(event);
  }
}
