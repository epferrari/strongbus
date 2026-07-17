
import {autobind} from 'core-decorators';
import {type CancelablePromise, cancelable, timeout} from 'jaasync';

import {Scanner} from './scanner';
import {normalizeScanParams, ScannerPools, type ScanParams} from './scannerPools';
import {StrongbusLogger} from './strongbusLogger';
import {DownstreamSnapshot, LifecycleManager, type LifecycleHost} from './lifecycleManager';
import {type Subscription, type EventMap, WILDCARD} from './types/events';
import type {EventHandler, EventSink, PipeSink, GenericHandler} from './types/eventHandlers';
import {Lifecycle} from './types/lifecycle';
import type {Logger} from './types/logger';
import {
  resolveDuplicateSubscriptionStrategy,
  type Options,
  type MaterializedBusOptions,
  type ListenerThresholds,
  type ConfigurableBusOptions
} from './types/options';
import {ListenerRegistryView, type ListenerRegistry, EMPTY_LISTENER_SET} from './types/listenerRegistry';
import {ListenerScope, type IntrospectionOptions} from './types/listenerScope';
import type {
  SubscriptionSurface,
  SubscriptionSurfaceAny,
  SubscriptionSurfaceNext,
  SubscriptionSurfacePipe,
  SubscriptionSurfaceScan,
  SubscriptionSurfaceUnpipe,
  NextResult,
  SubscribeOptions
} from './types/surfaces/subscriptionSurface';
import type {ControlSurface} from './types/surfaces/controlSurface';
import type {
  IntrospectionSurface,
  IntrospectionSurfaceHasListenersForEvent,
  IntrospectionSurfaceListenerCountForEvent,
  IntrospectionSurfaceListenerForEach,
  IntrospectionSurfaceListenerForEvent
} from './types/surfaces/introspectionSurface';
import type {MonitoringSurface, MonitoringHook} from './types/surfaces/monitoringSurface';
import type {EventKeys, SubscribableEventKeys, VoidEventKeys} from './types/utility';
import {over} from './utils/over';
import {subscribeListenable} from './utils/subscribeListenable';
import {INTERNAL_PROMISE} from './utils/internalPromiseSymbol';
import {isSubscribeOptions} from './utils/isSubscribeOptions';
import {Forwards} from './forwards';
import {SubscriptionManager, type SubscriptionHost} from './subscriptionManager';



export interface Bus<TEventMap extends EventMap = EventMap> extends
  ControlSurface<TEventMap>,
  SubscriptionSurface<TEventMap>,
  IntrospectionSurface<TEventMap>,
  MonitoringSurface<TEventMap> {}

@autobind
export class Bus<TEventMap extends EventMap = EventMap> implements
  ControlSurface<TEventMap>,
  SubscriptionSurface<TEventMap>,
  IntrospectionSurface<TEventMap>,
  MonitoringSurface<TEventMap> {

  private static defaultOptions: MaterializedBusOptions = {
    name: 'Anonymous',
    allowUnhandledEvents: true,
    thresholds: {
      info: 100,
      warn: 500,
      error: Infinity
    },
    logger: console,
    verbose: false,
    coalesceDownstreamLifecycleEvents: true,
    duplicateSubscriptionStrategy: resolveDuplicateSubscriptionStrategy()
  };

  /**
   * Merge `options` onto {@link Bus} static defaults for all subsequently constructed
   * instances. Nested `thresholds` are merged recursively. `name` cannot be set here;
   * pass it to the constructor for per-instance naming.
   */
  public static configure(options: ConfigurableBusOptions): void {
    const {name: _name, ...configurable} = options as Partial<Options>;
    Bus.defaultOptions = Bus.mergeOptions(Bus.defaultOptions, configurable);
  }

  /**
   * @deprecated Use {@link Bus.configure} instead.
   */
  public static set defaultAllowUnhandledEvents(allow: boolean) {
    Bus.configure({allowUnhandledEvents: allow});
  }

  /**
   * @deprecated Use {@link Bus.configure} instead.
   */
  public static set defaultThresholds(thresholds: Partial<ListenerThresholds>) {
    Bus.configure({thresholds});
  }

  /**
   * @deprecated Use {@link Bus.configure} instead.
   */
  public static set verbose(verbose: boolean) {
    Bus.configure({verbose});
  }

  /**
   * @deprecated Use {@link Bus.configure} instead.
   */
  public static set defaultLogger(logger: Logger) {
    Bus.configure({logger});
  }

  private static mergeOptions(
    base: MaterializedBusOptions,
    overrides: Partial<Options> = {}
  ): MaterializedBusOptions {
    return {
      ...base,
      ...overrides,
      thresholds: {
        ...base.thresholds,
        ...overrides.thresholds
      },
      duplicateSubscriptionStrategy: resolveDuplicateSubscriptionStrategy({
        ...base.duplicateSubscriptionStrategy,
        ...overrides.duplicateSubscriptionStrategy
      })
    };
  }

  private readonly downstreams = new Map<Bus<TEventMap>, {
    unlink: VoidFunction;
    incognito: boolean;
  }>();
  private readonly downstreamListenerCountsByEvent = new Map<EventKeys<TEventMap>|WILDCARD, number>();
  private readonly forwards = new Forwards();
  private readonly subscriptions!: SubscriptionManager<TEventMap>;
  private readonly scannerPools = new ScannerPools<TEventMap>();
  private _downstreamListenerTotalCount: number = 0;
  private _cachedCombinedListeners: Map<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>>;
  private _cachedCombinedListenersWithIncognito: Map<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>>;
  private _cachedOwnListeners: Map<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>>;
  private _cachedOwnListenersWithIncognito: Map<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>>;
  private _cachedDownstreamListeners: Map<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>>;
  private _cachedDownstreamListenersWithIncognito: Map<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>>;

  // set on-construct
  private readonly options!: MaterializedBusOptions;
  private readonly logger!: StrongbusLogger<TEventMap>;
  private readonly listenersRegistry!: ListenerRegistry<TEventMap>;
  private readonly listenersRegistryWithIncognito!: ListenerRegistry<TEventMap>;
  private readonly ownListenersRegistry!: ListenerRegistry<TEventMap>;
  private readonly ownListenersRegistryWithIncognito!: ListenerRegistry<TEventMap>;
  private readonly downstreamListenersRegistry!: ListenerRegistry<TEventMap>;
  private readonly downstreamListenersRegistryWithIncognito!: ListenerRegistry<TEventMap>;
  private readonly lifecycle!: LifecycleManager<TEventMap>;
  /**
   * Subscribe to meta changes to the {@link Bus} with {@link Lifecycle} events
   */
  public readonly hook!: MonitoringHook<TEventMap>;

  constructor(options?: Options) {
    this.options = Bus.mergeOptions(Bus.defaultOptions, options);
    this.logger = new StrongbusLogger<TEventMap>({
      ...this.options,
      provider: this.options.logger,
      name: this.name
    });
    this.listenersRegistry = ListenerRegistryView.create(() => this.getCombinedListenersMap(false));
    this.listenersRegistryWithIncognito = ListenerRegistryView.create(() => this.getCombinedListenersMap(true));
    this.ownListenersRegistry = ListenerRegistryView.create(() => this.getOwnListenersMap(false));
    this.ownListenersRegistryWithIncognito = ListenerRegistryView.create(() => this.getOwnListenersMap(true));
    this.downstreamListenersRegistry = ListenerRegistryView.create(() => this.getDownstreamListenersMap(false));
    this.downstreamListenersRegistryWithIncognito = ListenerRegistryView.create(() => this.getDownstreamListenersMap(true));
    this.lifecycle = new LifecycleManager<TEventMap>({
      host: this.createLifecycleHost(),
      options: this.options,
      logger: this.logger
    });
    this.hook = this.lifecycle.hook;
    this.subscriptions = new SubscriptionManager({
      host: this.createSubscriptionHost(),
      options: this.options,
      logger: this.logger,
      forwards: this.forwards,
      lifecycle: this.lifecycle
    });
  }

  /**
   * @override
   * Declare how the bus should handle events emitted that have no listeners.
   * Will be invoked when an instance's `options.allowUnhandledEvents = false` (default is true).
   * The default implementation is to throw an error.
   */
  protected handleUnexpectedEvent<T extends EventKeys<TEventMap>>(
    event: T,
    payload?: TEventMap[T]
  ) {
    const errorMessage = [
      `Strongbus.Bus received unexpected message type '${String(event)}' with contents:`,
      JSON.stringify(payload, null, 2)
    ].join('\n');

    throw new Error(errorMessage);
  }

  /**
   * Subscribe a callback to an event.
   * Duplicate behavior is governed by {@link Options.duplicateSubscriptionStrategy}.
   */
  public on<T extends SubscribableEventKeys<TEventMap>>(
    event: T,
    handler: EventHandler<TEventMap, T>,
    options?: SubscribeOptions
  ): Subscription {
    return this.subscriptions.on(event, handler, options);
  }

  /**
   * Remove a handler previously registered with {@link Bus.on}.
   * Pass the same function reference; no-op if that handler is not registered for `event`.
   * Honors `duplicateSubscriptionStrategy.disposal` (`collapse` clears all stacked `on` intent;
   * `stack` pops the oldest frame — head of the stack). Does not remove {@link Bus.once} /
   * {@link Bus.any} / {@link Bus.pipe} intent.
   */
  public off<T extends SubscribableEventKeys<TEventMap>>(event: T, handler: EventHandler<TEventMap, T>): void {
    this.subscriptions.off(event, handler);
  }

  /**
   * Subscribe a callback to an event. Automatically unsubscribes after the first invocation.
   * Duplicate `once` registrations honor strategy `observability`, `invocation`, and `logLevel`;
   * disposal is always isolated from {@link Bus.on} for the same handler.
   */
  public once<T extends SubscribableEventKeys<TEventMap>>(
    event: T,
    handler: EventHandler<TEventMap, T>,
    options?: SubscribeOptions
  ): Subscription {
    return this.subscriptions.once(event, handler, options);
  }

  public emit<T extends VoidEventKeys<TEventMap>>(event: T, payload?: null | undefined): boolean;
  public emit<T extends EventKeys<TEventMap>>(event: T, payload: TEventMap[T]): boolean;
  public emit(
    ...args: {[K in EventKeys<TEventMap>]: [event: K, payload: TEventMap[K]]}[EventKeys<TEventMap>]
  ): boolean;
  public emit(
    event: EventKeys<TEventMap>,
    payload?: TEventMap[EventKeys<TEventMap>]
  ): boolean {
    if((event as EventKeys<TEventMap> | WILDCARD) === WILDCARD) {
      throw new Error(`Do not emit "${String(event)}" manually. Reserved for internal use.`);
    }

    let handled = false;

    this.forwards.begin();
    try {
      handled = this.subscriptions.consumeEvent(event, payload) || handled;
      handled = this.subscriptions.consumeEvent(WILDCARD, event, payload) || handled;
      this.forwards.flush();
      handled = this.propagateDownstream(event, payload) || handled;
    } finally {
      this.forwards.end();
    }

    if(!handled && !this.options.allowUnhandledEvents) {
      this.handleUnexpectedEvent(event, payload);
    }
    return handled;
  }

  /**
   * Handle multiple events with the same handler.
   * {@link EventSink} receives raised event as first argument, payload as second argument.
   * Duplicate `any` with the same event set (order-independent) and handler honors
   * {@link Options.duplicateSubscriptionStrategy}.
   */
  public any: SubscriptionSurfaceAny<TEventMap> = ((
    events,
    handler,
    options?: SubscribeOptions
  ) => {
    return this.subscriptions.any(
      events as EventKeys<TEventMap>[],
      handler as unknown as EventSink<TEventMap>,
      options
    );
  }) as SubscriptionSurfaceAny<TEventMap>;

  /**
   * Utility for resolving/rejecting a promise based on the reception of an event.
   * Promise resolves with the triggering event and its payload as `{event, payload}`.
   *
   * Triggers must be {@link SubscribableListenable} values.
   * The `'*'` wildcard is not accepted (see {@link SubscriptionSurface.next}).
   *
   * @param resolutionTrigger - specific event(s) that resolve the promise
   * @param rejectionTrigger - specific event(s) that reject the promise. Must be mutually disjoint with `resolutionTrigger`
   *
   * @example
   * ```typescript
   * // resolve on the first of several events
   * const {event, payload} = await bus.next(['message', 'connected', 'count']);
   *
   * // conditional or filtered resolution — use scan (supports trigger: '*')
   * const ready = await bus.scan('*', (resolve) => {
   *   if (resolve.trigger.type === 'event' && isReady(resolve.trigger)) {
   *     resolve(true);
   *   }
   * });
   * ```
   */
  public next: SubscriptionSurfaceNext<TEventMap> = ((
    resolutionTrigger,
    rejectionTriggerOrOptions?: unknown,
    maybeOptions?: SubscribeOptions
  ) => {
    type T = typeof resolutionTrigger;
    type TResult = NextResult<TEventMap, T>;
    let settled: boolean = false;
    let resolveInternalPromise: (value: TResult) => void;
    let rejectInternalPromise: (err?: Error) => void;
    let willDestroyListener: Subscription;

    let rejectionTrigger: typeof rejectionTriggerOrOptions | undefined;
    let options: SubscribeOptions | undefined;
    if(maybeOptions !== undefined) {
      rejectionTrigger = rejectionTriggerOrOptions;
      options = maybeOptions;
    } else if(isSubscribeOptions(rejectionTriggerOrOptions)) {
      rejectionTrigger = undefined;
      options = rejectionTriggerOrOptions;
    } else {
      rejectionTrigger = rejectionTriggerOrOptions;
    }

    const resolutionSub = subscribeListenable(this, resolutionTrigger, (event, payload) => {
      resolve({event, payload} as TResult);
    }, options);
    const rejectionSub = rejectionTrigger
      ? subscribeListenable(this, rejectionTrigger as any, (event) => {
          reject(new Error(`Rejected with event (${String(event)})`));
        }, options)
      : null;

    function resolve(result: TResult): void {
      if(settle()) {
        resolveInternalPromise?.(result);
      }
    }

    function reject(err?: Error): void {
      if(settle()) {
        rejectInternalPromise?.(err);
      }
    }

    function settle(): boolean {
      if(settled) {
        return false;
      }
      resolutionSub();
      rejectionSub?.();
      willDestroyListener?.();
      settled = true;
      return true;
    }

    const p: CancelablePromise<TResult> = cancelable<TResult>(() => {
      return new Promise<TResult>(($resolve, $reject) => {
        resolveInternalPromise = $resolve;
        rejectInternalPromise = $reject;
      });
    });

    // handle cancelation
    p.catch((e: unknown): void => undefined).finally(settle);

    willDestroyListener = this.hook('willDestroy', () => p.cancel(`${this.name} destroyed`));

    return p;
  }) as SubscriptionSurfaceNext<TEventMap>;

  /**
   * Utility for resolving/rejecting a promise based on an evaluation done when an event is triggered.
   * If `options.eager` is true (default), evaluates the condition immediately.
   * If the evaluator resolves or rejects during eager evaluation, the scanner does not subscribe to any events.
   *
   * @param trigger - {@link Listenable} event or events that trigger the evaluator, including `'*'`.
   *   Discriminate on `resolve.trigger` when reading `event` or `payload`.
   * @param evaluator - checks for a certain state and may resolve or reject the scan.
   * @param options.pool - attempt to pool scanners that share the same evaluator and trigger; default `true`.
   * @param options.timeout - cancel the scan after N milliseconds. Values `<= 0` are ignored.
   *   Configuring a timeout disables pooling even when `options.pool` is true.
   * @param options.eager - call the evaluator immediately; default `true`.
   *   This eliminates the anti-pattern of guarding `scan` with `if (!condition)`.
   */
  public scan: SubscriptionSurfaceScan<TEventMap> = ((
    ...args: unknown[]
  ): CancelablePromise<any> => {
    const params = normalizeScanParams<TEventMap>(args);
    const scanParams = params as unknown as ScanParams<any, TEventMap>;

    const subscribeOptions: SubscribeOptions | undefined = params.incognito
      ? {incognito: true}
      : undefined;

    if(params.timeout && params.timeout > 0) {
      const scanner = new Scanner<any>(scanParams);
      scanner.scan<TEventMap>(this, params.trigger, subscribeOptions);
      // tslint:disable-next-line:prefer-object-spread
      return Object.assign(
        timeout(scanner, {ms: params.timeout, cancelUnderlyingPromiseOnTimeout: true}),
        {
          [INTERNAL_PROMISE]: scanner,
          cancel: (err: any) => scanner.cancel(err)
        }
      );
    } else if(params.pool === false) {
      const scanner = new Scanner<any>(scanParams);
      scanner.scan<TEventMap>(this, params.trigger, subscribeOptions);
      // tslint:disable-next-line:prefer-object-spread
      return Object.assign(
        scanner,
        {[INTERNAL_PROMISE]: scanner}
      );

    }

    return this.scannerPools.scan<any>(this, scanParams);
  }) as SubscriptionSurfaceScan<TEventMap>;

  /**
   * Pipe events into another {@link Bus}, or into a function sink.
   * Function sinks must satisfy {@link PipeSink}: they receive the raised event as
   * a single correlated `{event, payload}` {@link PipeMessage}, plus a `forward`
   * function bound to that message. `forward(dst)` queues a re-emit on a
   * payload-compatible bus (no downstream link) for the delegation phase after
   * this bus's own handlers, and returns a promise that resolves to
   * `dst.emit`'s result — or `false` if `forward` expired after this emit completed.
   *
   * Bus-to-bus piping returns the downstream bus (for chaining), and requires a real
   * {@link Bus} instance — not a hand-rolled surface duck type.
   */
  public pipe: SubscriptionSurfacePipe<TEventMap> = ((
    dest: PipeSink<TEventMap> | Bus<any>,
    options?: SubscribeOptions
  ): Subscription | Bus<any> => {
    if(typeof dest === 'function') {
      return this.subscriptions.pipeSink(dest as PipeSink<TEventMap>, options);
    } else {
      const downstream = dest;
      if(downstream !== this as any) {
        if(!this.downstreams.has(downstream)) {
          const incognito = options?.incognito === true;
          if(incognito) {
            this.downstreams.set(downstream, {
              unlink: () => undefined,
              incognito: true
            });
          } else {
            this.downstreams.set(downstream, {
              unlink: over([
                downstream.hook(Lifecycle.willAddListener, (event) => this.lifecycle.onDownstreamWillAdd(event as EventKeys<TEventMap>|WILDCARD)),
                downstream.hook(Lifecycle.didAddListener, (event) => this.lifecycle.onDownstreamDidAdd(event as EventKeys<TEventMap>|WILDCARD)),
                downstream.hook(Lifecycle.willRemoveListener, (event) => this.lifecycle.onDownstreamWillRemove(event as EventKeys<TEventMap>|WILDCARD)),
                downstream.hook(Lifecycle.didRemoveListener, (event) => this.lifecycle.onDownstreamDidRemove(event as EventKeys<TEventMap>|WILDCARD))
              ]),
              incognito: false
            });
            this.lifecycle.onDownstreamAttached(this.buildDownstreamSnapshot(downstream));
          }
          this.invalidateCombinedListenerCache();
        }
      }
      return downstream;
    }
  }) as SubscriptionSurfacePipe<TEventMap>;

  /**
   * Stop piping events into a bus downstream or function sink previously passed to
   * {@link Bus.pipe}. Function sinks must satisfy {@link PipeSink}.
   */
  public unpipe: SubscriptionSurfaceUnpipe<TEventMap> = ((
    dest: PipeSink<TEventMap> | Bus<any>
  ) => {
    if(typeof dest === 'function') {
      this.subscriptions.unpipeSink(dest as PipeSink<TEventMap>);
    } else {
      const downstream = dest;
      const link = this.downstreams.get(downstream);
      if(link) {
        if(!link.incognito) {
          const snapshot = this.buildDownstreamSnapshot(downstream);
          this.lifecycle.onDownstreamDetached(snapshot);
        }
        link.unlink();
        this.downstreams.delete(downstream);
        this.invalidateCombinedListenerCache();
      }
    }
  }) as SubscriptionSurfaceUnpipe<TEventMap>;

  /**
   * Subscribe to meta states of the {@link Bus}, `idle` and `active`.
   * Bus becomes idle when it goes from 1 to 0 subscribers, and active when it goes from 0 to 1.
   * The handler receives a `boolean` indicating if the bus is active (`true`) or idle (`false`)
   */
  public monitor(handler: (activeState: boolean) => void): Subscription {
    return this.lifecycle.monitor(handler);
  }

  /**
   * The active state of the bus, i.e. does it have any subscribers. Subscribers include downstreams and scanners.
   */
  public get active(): boolean {
    return this.lifecycle.active;
  }

  /**
   * The bus's name, combining the configured `options.name` with the constructor name.
   */
  public get name(): string {
    return `${this.options.name} ${this.constructor.name}`;
  }

  /**
   * Whether the bus has any listeners in `options.scope` (defaults to `ListenerScope.ANY`).
   */
  public hasListeners(options: IntrospectionOptions = {}): boolean {
    return this.getListenerCount(options) > 0;
  }

  /**
   * Total handler registrations in `options.scope` (defaults to `ListenerScope.ANY`).
   * For `ListenerScope.ANY`, sums own and downstream counts (the same handler on both
   * still counts twice).
   */
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

  private static readonly _emptyListenersRegistry: ListenerRegistry<any> =
    ListenerRegistryView.create(() => new Map());

  private registryForScope(scope: ListenerScope, includeIncognito = false): ListenerRegistry<TEventMap> {
    if((scope & ListenerScope.ANY) === ListenerScope.ANY) {
      return includeIncognito ? this.listenersRegistryWithIncognito : this.listenersRegistry;
    } else if((scope & ListenerScope.OWN) === ListenerScope.OWN) {
      return includeIncognito ? this.ownListenersRegistryWithIncognito : this.ownListenersRegistry;
    } else if((scope & ListenerScope.DOWNSTREAM) === ListenerScope.DOWNSTREAM) {
      return includeIncognito ? this.downstreamListenersRegistryWithIncognito : this.downstreamListenersRegistry;
    }
    return Bus._emptyListenersRegistry;
  }

  private getCombinedListenersMap(
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

  private getDownstreamListenersMap(
    includeIncognito = false
  ): ReadonlyMap<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>> {
    const cached = includeIncognito
      ? this._cachedDownstreamListenersWithIncognito
      : this._cachedDownstreamListeners;
    if(!cached) {
      const downstreamListenerCache = new Map<EventKeys<TEventMap>|WILDCARD, Set<GenericHandler>>();
      for(const [downstream, link] of this.downstreams) {
        if(link.incognito && !includeIncognito) {
          continue;
        }
        for(const [event, listeners] of downstream.getCombinedListenersMap(includeIncognito)) {
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
      }
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

  private invalidateCombinedListenerCache(): void {
    this._cachedCombinedListeners = null;
    this._cachedCombinedListenersWithIncognito = null;
    this._cachedDownstreamListeners = null;
    this._cachedDownstreamListenersWithIncognito = null;
  }

  private invalidateOwnListenerCache(): void {
    this._cachedOwnListeners = null;
    this._cachedOwnListenersWithIncognito = null;
  }

  /**
   * Remove all event subscribers, lifecycle subscribers, and downstreams.
   * Triggers lifecycle meta events for all subscribed events before removing
   * lifecycle subscribers, emitting {@link Lifecycle.willDestroy} during teardown.
   */
  public destroy() {
    this.subscriptions.releaseAll();
    this.lifecycle.destroy();
    this.releaseDownstreams();
  }

  private releaseDownstreams(): void {
    for(const link of this.downstreams.values()) {
      link.unlink();
    }
    this.downstreams.clear();
  }

  private propagateDownstream<T extends EventKeys<TEventMap>>(event: T, payload?: TEventMap[T]): boolean {
    const {downstreams: _downstreams} = this;
    let handled = false;
    for(const d of this.downstreams.keys()) {
      handled = d.emit(event as any, payload as any) || handled;
    }
    return handled;
  }


  private createSubscriptionHost(): SubscriptionHost {
    const {
      name,
      invalidateOwnListenerCache,
      invalidateCombinedListenerCache
    } = this;
    return {
      get name() {
        return name;
      },
      invalidateOwnListenerCache,
      invalidateCombinedListenerCache
    };
  }

  private createLifecycleHost(): LifecycleHost<TEventMap> {
    return {
      hasListeners: this.hasListeners,
      getListenerCount: this.getListenerCount,
      getOwnListenerCount: () => this.getListenerCount({scope: ListenerScope.OWN}),
      getListenerCountFor: this.getListenerCountFor,
      accountForDownstreamListeners: this.accountForDownstreamListeners,
      accountForRemovedDownstreamListeners: this.accountForRemovedDownstreamListeners
    };
  }

  private buildDownstreamSnapshot(downstream: Bus<any>) {
    return Bus.downstreamSnapshotFromListenersMap<TEventMap>(
      downstream.getCombinedListenersMap(false) as ReadonlyMap<
        EventKeys<TEventMap>|WILDCARD,
        ReadonlySet<GenericHandler>
      >
    );
  }

  private accountForDownstreamListeners(event: EventKeys<TEventMap>|WILDCARD, count: number): void {
    const currCount = this.downstreamListenerCountsByEvent.get(event) ?? 0;
    this.downstreamListenerCountsByEvent.set(event, Math.max(currCount + count, 0));
    this._downstreamListenerTotalCount = Math.max(this._downstreamListenerTotalCount + count, 0);
    this.invalidateCombinedListenerCache();
  }

  private accountForRemovedDownstreamListeners(event: EventKeys<TEventMap>|WILDCARD, count: number): void {
    const currCount = this.downstreamListenerCountsByEvent.get(event) ?? 0;
    this.downstreamListenerCountsByEvent.set(event, Math.max(currCount - count, 0));
    this._downstreamListenerTotalCount = Math.max(this._downstreamListenerTotalCount - count, 0);
    this.invalidateCombinedListenerCache();
  }


  /**
   * @ignore
   */
  private static downstreamSnapshotFromListenersMap<TEventMap extends EventMap>(
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
