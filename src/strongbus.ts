
import {autobind} from 'core-decorators';
import {type CancelablePromise, cancelable, timeout} from 'jaasync';

import {Scanner} from './scanner';
import {ScannerPools, type ScanParams as InternalScanParams} from './scannerPools';
import {StrongbusLogger} from './strongbusLogger';
import {type Subscription, type EventMap, WILDCARD} from './types/events';
import type {EventHandler, EventSink, PipeSink, PipeMessage, PipeForward, GenericHandler} from './types/eventHandlers';
import {Lifecycle} from './types/lifecycle';
import type {Logger} from './types/logger';
import type {Options, ListenerThresholds} from './types/options';
import {ListenerRegistryView, type ListenerRegistry, EMPTY_LISTENER_SET} from './types/listenerRegistry';
import {ListenerScope, type IntrospectionOptions} from './types/listenerScope';
import type {
  AnyEventMap,
  SubscriptionSurface,
  SubscriptionSurfaceAny,
  SubscriptionSurfaceNext,
  SubscriptionSurfacePipe,
  SubscriptionSurfaceScan,
  SubscriptionSurfaceUnpipe,
  NextResult,
  ScanOptions
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
import type {StrongbusEventMapBranded} from './types/strongbusEventMapBrand';
import type {EventKeys, SubscribableEventKeys, VoidEventKeys} from './types/utility';
import {over} from './utils/over';
import {subscriptionWrapper} from './utils/subscriptionWrapper';
import {randomId} from './utils/randomId';
import {subscribeListenable} from './utils/subscribeListenable';
import {INTERNAL_PROMISE} from './utils/internalPromiseSymbol';
import {normalizeError} from './utils/normalizeError';


@autobind
export class Bus<TEventMap extends EventMap = EventMap> implements
  ControlSurface<TEventMap>,
  SubscriptionSurface<TEventMap>,
  IntrospectionSurface<TEventMap>,
  MonitoringSurface<TEventMap>,
  StrongbusEventMapBranded<TEventMap> {

  /**
   * Phantom brand for event-map inference on subclasses and `forward`/`pipe` targets.
   * Subclasses should redeclare with their map type parameter, e.g.
   * `declare readonly strongbusEventMap: M`.
   *
   * @see {@link StrongbusEventMapBranded}
   */
  public declare readonly strongbusEventMap: TEventMap;

  private static defaultOptions: Required<Options> & {thresholds: Required<ListenerThresholds>} = {
    name: 'Anonymous',
    allowUnhandledEvents: true,
    thresholds: {
      info: 100,
      warn: 500,
      error: Infinity
    },
    logger: console,
    verbose: true // keep legacy behavior in 2.x version
  };

  /**
   * Set the default for `Bus.options.allowUnhandledEvents` for all instances.
   */
  public static set defaultAllowUnhandledEvents(allow: boolean) {
    Bus.defaultOptions.allowUnhandledEvents = allow;
  }

  /**
   * Set the default `Bus.options.thresholds` for all instances.
   */
  public static set defaultThresholds(thresholds: Partial<ListenerThresholds>) {
    Bus.defaultOptions.thresholds = {
      ...Bus.defaultOptions.thresholds,
      ...thresholds
    };
  }

  /**
   * Set the default `Bus.options.verbose` for all instances.
   */
   public static set verbose(verbose: boolean) {
    Bus.defaultOptions.verbose = verbose;
  }

  /**
   * Set the default logger for all instances to an object that implements the {@link Logger} interface.
   */
  public static set defaultLogger(logger: Logger) {
    Bus.defaultOptions.logger = logger;
  }

  private readonly delegates = new Map<Bus<TEventMap>, Subscription[]>();
  private readonly delegateListenerCountsByEvent = new Map<EventKeys<TEventMap>|WILDCARD, number>();
  private readonly sinks = new WeakMap<PipeSink<TEventMap>, Subscription>();
  private readonly listenersRegistry: ListenerRegistry<TEventMap>;
  private readonly ownListenersRegistry: ListenerRegistry<TEventMap>;
  private readonly delegateListenersRegistry: ListenerRegistry<TEventMap>;
  private readonly subscriptionCache = new Map<string, Subscription>();
  private readonly options: Required<Options> & {thresholds: Required<ListenerThresholds>};
  private readonly bus = new Map<EventKeys<TEventMap>|WILDCARD, Set<GenericHandler>>();
  private readonly lifecycle = new Map<Lifecycle, Set<GenericHandler>>();
  private readonly scannerPools = new ScannerPools<TEventMap>();
  private readonly logger: StrongbusLogger<TEventMap>;
  // queue of unsubscription requests so that they are processed transactionally in order
  private readonly unsubQueue: {
    token: string;
    event: EventKeys<TEventMap>|WILDCARD;
    handler: GenericHandler;
  }[] = [];

  // volatile internal state
  private _active = false;
  private _purgingUnsubQueue: boolean = false;
  private _delegateListenerTotalCount: number = 0;
  private _cachedCombinedListenersMap: Map<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>>;
  private _cachedOwnListenersMap: Map<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>>;
  private _cachedDelegateListenersMap: Map<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>>;


  constructor(options?: Options) {
    this.options = {
      ...Bus.defaultOptions,
      ...options || {},
      thresholds: {
        ...Bus.defaultOptions.thresholds,
        ...options?.thresholds || {}
      }
    };
    this.logger = new StrongbusLogger<TEventMap>({
      ...this.options,
      provider: this.options.logger,
      name: this.name
    });
    this.listenersRegistry = ListenerRegistryView.create(() => this.getCombinedListenersMap());
    this.ownListenersRegistry = ListenerRegistryView.create(() => this.getOwnListenersMap());
    this.delegateListenersRegistry = ListenerRegistryView.create(() => this.getDelegateListenersMap());
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
   */
  public on<T extends SubscribableEventKeys<TEventMap>>(event: T, handler: EventHandler<TEventMap, T>): Subscription {
    return this.addListener(event, handler);
  }

  /**
   * Subscribe a callback to an event. Automatically unsubscribes after the first invocation.
   */
  public once<T extends SubscribableEventKeys<TEventMap>>(event: T, handler: EventHandler<TEventMap, T>): Subscription {
    let sub: Subscription;
    const wrapper = ((payload: TEventMap[T]) => {
      sub();
      handler(payload);
    }) as GenericHandler;
    sub = this.addListener(event, wrapper);
    return sub;
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

    handled = this.emitEvent(event, payload) || handled;
    handled = this.emitEvent(WILDCARD, event, payload) || handled;
    handled = this.forward(event, payload) || handled;

    if(!handled && !this.options.allowUnhandledEvents) {
      this.handleUnexpectedEvent(event, payload);
    }
    return handled;
  }

  /**
   * Handle multiple events with the same handler.
   * {@link EventSink} receives raised event as first argument, payload as second argument
   */
  public any: SubscriptionSurfaceAny<TEventMap> = ((
    events,
    handler
  ) => {
    return subscriptionWrapper(over(
      (events as EventKeys<TEventMap>[]).map((e) => {
        const anyHandler = (payload: TEventMap[typeof e]) => handler(e as EventKeys<AnyEventMap<TEventMap>>, payload as any);
        return this.addListener(e, anyHandler);
      })
    ));
  }) as SubscriptionSurfaceAny<TEventMap>;

  /**
   * Utility for resolving/rejecting a promise based on the reception of an event.
   * Promise resolves with the triggering event and its payload as `{event, payload}`.
   *
   * Triggers must be {@link SubscribableListenable} values.
   * The `'*'` wildcard is not accepted (see {@link SubscriptionSurfaceNext}).
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
    rejectionTrigger
  ) => {
    type T = typeof resolutionTrigger;
    type TResult = NextResult<TEventMap, T>;
    let settled: boolean = false;
    let resolveInternalPromise: (value: TResult) => void;
    let rejectInternalPromise: (err?: Error) => void;
    let willDestroyListener: Subscription;

    const resolutionSub = subscribeListenable(this, resolutionTrigger, (event, payload) => {
      resolve({event, payload} as TResult);
    });
    const rejectionSub = rejectionTrigger
      ? subscribeListenable(this, rejectionTrigger, (event) => {
          reject(new Error(`Rejected with event (${String(event)})`));
        })
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
    const scanParams = params as unknown as InternalScanParams<any, TEventMap>;

    if(params.timeout && params.timeout > 0) {
      const scanner = new Scanner<any>(scanParams);
      scanner.scan<TEventMap>(this, params.trigger);
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
      scanner.scan<TEventMap>(this, params.trigger);
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
   * function bound to that message. `forward(dst)` re-emits the whole message on a
   * payload-compatible bus without registering a delegate.
   *
   * Bus-to-bus piping returns the delegate bus (for chaining), and requires a real
   * {@link Bus} instance — not a hand-rolled surface duck type.
   */
  public pipe: SubscriptionSurfacePipe<TEventMap> = ((
    dest: PipeSink<TEventMap> | Bus<any>
  ): Subscription | Bus<any> => {
    if(typeof dest === 'function') {
      const sink = dest as PipeSink<TEventMap>;
      const wrapper: GenericHandler = (event, payload) => {
        const forward = ((target: {emit: (e: any, p: any) => boolean}) =>
          target.emit(event, payload)) as PipeForward<TEventMap>;
        sink({event, payload} as PipeMessage<TEventMap>, forward);
      };
      this.sinks.set(sink, this.addListener(WILDCARD, wrapper));
      return subscriptionWrapper(() => this.unpipe(sink));
    } else {
      const bus = dest;
      if(bus !== this as any) {
        if(!this.delegates.has(bus)) {
          this.delegates.set(bus, [
            bus.hook(Lifecycle.willAddListener, (event) => this.willAddListener(event as EventKeys<TEventMap>|WILDCARD)),
            bus.hook(Lifecycle.didAddListener, (event) => this.didAddListener(event as EventKeys<TEventMap>|WILDCARD, bus)),
            bus.hook(Lifecycle.willRemoveListener, (event) => this.willRemoveListener(event as EventKeys<TEventMap>|WILDCARD)),
            bus.hook(Lifecycle.didRemoveListener, (event) => this.didRemoveListener(event as EventKeys<TEventMap>|WILDCARD, bus))
          ]);
        }
      }
      return bus;
    }
  }) as SubscriptionSurfacePipe<TEventMap>;

  /**
   * Stop piping events into a bus delegate or function sink previously passed to
   * {@link Bus.pipe}. Function sinks must satisfy {@link PipeSink}.
   */
  public unpipe: SubscriptionSurfaceUnpipe<TEventMap> = ((
    dest: PipeSink<TEventMap> | Bus<any>
  ) => {
    if(typeof dest === 'function') {
      this.sinks.get(dest as PipeSink<TEventMap>)?.();
      this.sinks.delete(dest as PipeSink<TEventMap>);
    } else {
      const bus = dest;
      over(this.delegates.get(bus) || [])();
      this.delegates.delete(bus);
    }
  }) as SubscriptionSurfaceUnpipe<TEventMap>;

  /**
   * Subscribe to meta changes to the {@link Bus} with {@link Lifecycle} events
   */
  public hook: MonitoringHook<TEventMap> = ((
    event,
    handler
  ) => {
    addListener(this.lifecycle, event, handler);
    return subscriptionWrapper(() => removeListener(this.lifecycle, event, handler));
  }) as MonitoringHook<TEventMap>;

  /**
   * Subscribe to meta states of the {@link Bus}, `idle` and `active`.
   * Bus becomes idle when it goes from 1 to 0 subscribers, and active when it goes from 0 to 1.
   * The handler receives a `boolean` indicating if the bus is active (`true`) or idle (`false`)
   */
  public monitor(handler: (activeState: boolean) => void): Subscription {
    return subscriptionWrapper(over([
      this.hook(Lifecycle.active, () => handler(true)),
      this.hook(Lifecycle.idle, () => handler(false))
    ]));
  }

  /**
   * The active state of the bus, i.e. does it have any subscribers. Subscribers include delegates and scanners.
   */
  public get active(): boolean {
    return this._active;
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
   * For `ListenerScope.ANY`, sums own and delegate counts (the same handler on both
   * still counts twice).
   */
  public getListenerCount(options: IntrospectionOptions = {}): number {
    const {scope = ListenerScope.ANY} = options;
    const includesOwn = (scope & ListenerScope.OWN) !== 0;
    const includesDelegate = (scope & ListenerScope.DELEGATE) !== 0;
    if(includesOwn && includesDelegate) {
      return this.getListenerCount({scope: ListenerScope.OWN}) + this.getListenerCount({scope: ListenerScope.DELEGATE});
    }
    let total = 0;
    this.registryForScope(scope).forEach(handlers => {
      total += handlers.size;
    });
    return total;
  }

  public getListeners(options: IntrospectionOptions = {}): ReadonlySet<GenericHandler> {
    const {scope = ListenerScope.ANY} = options;
    const union = new Set<GenericHandler>();
    this.registryForScope(scope).forEach(handlers => {
      for(const handler of handlers) {
        union.add(handler);
      }
    });
    return union;
  }

  public getEventCount(options: IntrospectionOptions = {}): number {
    const {scope = ListenerScope.ANY} = options;
    return this.registryForScope(scope).size;
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
    const {scope = ListenerScope.ANY} = options;
    const includesOwn = (scope & ListenerScope.OWN) !== 0;
    const includesDelegate = (scope & ListenerScope.DELEGATE) !== 0;
    if(includesOwn && includesDelegate) {
      return this.getListenerCountFor(event, {scope: ListenerScope.OWN})
        + this.getListenerCountFor(event, {scope: ListenerScope.DELEGATE});
    }
    return this.registryForScope(scope).getCount(event);
  }) as IntrospectionSurfaceListenerCountForEvent<TEventMap>;

  public getListenersFor: IntrospectionSurfaceListenerForEvent<TEventMap> = ((
    event,
    options: IntrospectionOptions = {}
  ) => {
    const {scope = ListenerScope.ANY} = options;
    return this.registryForScope(scope).get(event) ?? EMPTY_LISTENER_SET;
  }) as IntrospectionSurfaceListenerForEvent<TEventMap>;

  public forEach: IntrospectionSurfaceListenerForEach<TEventMap> = ((
    fn,
    options: IntrospectionOptions = {}
  ) => {
    const {scope = ListenerScope.ANY} = options;
    this.registryForScope(scope).forEach((handlers, event) => {
      fn(event, handlers);
    });
  }) as IntrospectionSurfaceListenerForEach<TEventMap>;

  private static readonly _emptyListenersRegistry: ListenerRegistry<any> =
    ListenerRegistryView.create(() => new Map());

  private registryForScope(scope: ListenerScope): ListenerRegistry<TEventMap> {
    const includesOwn = (scope & ListenerScope.OWN) !== 0;
    const includesDelegate = (scope & ListenerScope.DELEGATE) !== 0;
    if(includesOwn && includesDelegate) {
      return this.listenersRegistry;
    }
    if(includesOwn) {
      return this.ownListenersRegistry;
    }
    if(includesDelegate) {
      return this.delegateListenersRegistry;
    }
    return Bus._emptyListenersRegistry;
  }

  private getCombinedListenersMap(): ReadonlyMap<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>> {
    if(!this._cachedCombinedListenersMap) {
      const listenerCache = new Map(this.getOwnListenersMap());
      for(const [event, delegateListeners] of this.getDelegateListenersMap()) {
        if(!delegateListeners.size) {
          continue;
        }
        let listeners = listenerCache.get(event);
        if(!listeners) {
          listeners = new Set<GenericHandler>();
          listenerCache.set(event, listeners);
        }
        for(const listener of delegateListeners) {
          (listeners as Set<any>).add(listener);
        }
      }
      this._cachedCombinedListenersMap = listenerCache;
    }
    return this._cachedCombinedListenersMap;
  }

  private getDelegateListenersMap(): ReadonlyMap<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>> {
    if(!this._cachedDelegateListenersMap) {
      const delegateListenerCache = new Map<EventKeys<TEventMap>|WILDCARD, Set<GenericHandler>>();
      for(const delegate of this.delegates.keys()) {
        for(const [event, listeners] of delegate.getCombinedListenersMap()) {
          if(!listeners.size) {
            continue;
          }
          let merged = delegateListenerCache.get(event);
          if(!merged) {
            merged = new Set<GenericHandler>();
            delegateListenerCache.set(event, merged);
          }
          for(const listener of listeners) {
            merged.add(listener);
          }
        }
      }
      this._cachedDelegateListenersMap = delegateListenerCache;
    }
    return this._cachedDelegateListenersMap;
  }

  private getOwnListenersMap(): ReadonlyMap<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>> {
    if(!this._cachedOwnListenersMap) {
      const ownListenerCache = new Map<EventKeys<TEventMap>|WILDCARD, Set<GenericHandler>>();
      for(const [event, listeners] of this.bus) {
        if(listeners.size) {
          ownListenerCache.set(event, new Set(listeners));
        }
      }
      this._cachedOwnListenersMap = ownListenerCache;
    }
    return this._cachedOwnListenersMap;
  }

  private invalidateCombinedListenerCache(): void {
    this._cachedCombinedListenersMap = null;
    this._cachedDelegateListenersMap = null;
  }

  private invalidateOwnListenerCache(): void {
    this._cachedOwnListenersMap = null;
  }

  /**
   * Remove all event subscribers, lifecycle subscribers, and delegates.
   * Triggers lifecycle meta events for all subscribed events before removing
   * lifecycle subscribers, emitting {@link Lifecycle.willDestroy} during teardown.
   */
  public destroy() {
    this.releaseSubscribers();
    this.emitLifecycleEvent(Lifecycle.willDestroy, null);
    this.lifecycle.clear();
    this.releaseDelegates();
  }

  private releaseSubscribers(): void {
    // any un-invoked unsubscribes will be invoked,
    // their lifecycle hooks will be triggered,
    // and they will be removed from the cache
    over(this.subscriptionCache)();
    this.bus.clear();
  }

  private releaseDelegates(): void {
    for(const subs of Object.values(this.delegates)) {
      for(const sub of subs()) {
        sub();
      }
    }
    this.delegates.clear();
  }

  private addListener(event: EventKeys<TEventMap>|WILDCARD, handler: GenericHandler): Subscription {
    const handlers = this.bus.get(event);
    const addingNewHandler = !(handlers?.has(handler));
    if(addingNewHandler) {
      const n: number = handlers?.size + 1 || 1;
      this.logger.onAddListener(event, n);
      this.willAddListener(event);
      const {added} = addListener(this.bus, event, handler);
      if(added) {
        this.didAddListener(event);
      }
    }
    return this.generateListenerSubscription(event as EventKeys<TEventMap>, handler);
  }

  private generateListenerSubscription(event: EventKeys<TEventMap>|WILDCARD, handler: GenericHandler): Subscription {
    const token = randomId();
    const sub = subscriptionWrapper(() => {
      this.unsubQueue.push({
        token,
        event,
        handler
      });
      this.purgeUnsubQueue();
    });
    this.subscriptionCache.set(token, sub);
    return sub;
  }

  private purgeUnsubQueue() {
    if(this._purgingUnsubQueue) {
      return;
    }

    this._purgingUnsubQueue = true;

    while(this.unsubQueue.length) {
      const {token, event, handler} = this.unsubQueue.shift();
      if(this.subscriptionCache.has(token)) {
        this.subscriptionCache.delete(token);
        // lifecycle events may trigger additional unsubs, which will be pushed to the end of queue and handled in a subsequent iteration of this loop
        this.removeListener(event, handler);
      }
    }

    this._purgingUnsubQueue = false;
  }

  private removeListener(event: EventKeys<TEventMap>|WILDCARD, handler: GenericHandler): void {
    this.willRemoveListener(event);
    const {removed} = removeListener(this.bus, event, handler);
    if(removed) {
      this.didRemoveListener(event);
      const count = this.bus.get(event)?.size ?? 0;
      this.logger.onListenerRemoved(event, count);
    }
  }

  private emitEvent(event: EventKeys<TEventMap>|WILDCARD, ...args: any[]): boolean {
    const handlers = this.bus.get(event);
      if(handlers && handlers.size) {
        for(const fn of handlers) {
          try {
            const execution = fn(...args);

            // emit errors if fn returns promise that rejects
            (execution as Promise<any>)?.catch?.((e) => {
              this.emitLifecycleEvent(Lifecycle.error, {error: e, event});
            });
          } catch(e: unknown) {
            // emit errors if callback fails synchronously
            this.emitLifecycleEvent(Lifecycle.error, {error: normalizeError(e), event});
          }
        }
        return true;
      }
      return false;
  }

  private emitLifecycleEvent<L extends Lifecycle>(event: L, payload: Lifecycle.EventMap<TEventMap>[L]): void {
    const handlers = this.lifecycle.get(event);
    if(handlers && handlers.size) {
      for(const fn of handlers) {
        try {
          const execution = fn(payload);

          // emit errors if fn returns promise that rejects
          (execution as Promise<any>)?.catch?.((e) => {
            if(event === Lifecycle.error) {
              const errorPayload = payload as Lifecycle.EventMap<TEventMap>['error'];
              this.logger.error('Error thrown in async error handler', {
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
          // emit errors if callback fails synchronously
          if(event === Lifecycle.error) {
            const errorPayload = payload as Lifecycle.EventMap<TEventMap>['error'];
            this.logger.error('Error thrown in error handler', {
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

  private forward<T extends EventKeys<TEventMap>>(event: T, payload?: TEventMap[T]): boolean {
    const {delegates: _delegates} = this;
    if(_delegates.size) {
      return Array.from(_delegates.keys())
        .reduce((acc, d) => (d.emit(event as any, payload as any) || acc), false);
    } else {
      return false;
    }
  }

  private willAddListener(event: EventKeys<TEventMap>|WILDCARD) {
    this.emitLifecycleEvent(Lifecycle.willAddListener, event);
    if(!this._active) {
      this.emitLifecycleEvent(Lifecycle.willActivate, null);
    }
  }

  private didAddListener(event: EventKeys<TEventMap>|WILDCARD, bus: Bus<any> = this) {

    this.invalidateCombinedListenerCache();
    if(bus === this) {
      this.invalidateOwnListenerCache();
    } else {
      const currCount = this.delegateListenerCountsByEvent.get(event) ?? 0;
      this.delegateListenerCountsByEvent.set(event, Math.max(currCount + 1, 0));
      this._delegateListenerTotalCount = Math.max(this._delegateListenerTotalCount + 1, 0);
    }

    this.emitLifecycleEvent(Lifecycle.didAddListener, event);
    if(!this._active && this.hasListeners()) {
      this._active = true;
      this.emitLifecycleEvent(Lifecycle.active, null);
    }
  }


  private willRemoveListener(event: EventKeys<TEventMap>|WILDCARD): void {
    const eventHandlerCount = this.getListenerCountFor(event);
    if(eventHandlerCount) {
      this.emitLifecycleEvent(Lifecycle.willRemoveListener, event);
      if(this._active && this.getListenerCount() === 1 && eventHandlerCount === 1) {
        this.emitLifecycleEvent(Lifecycle.willIdle, null);
      }
    }
  }

  private didRemoveListener(event: EventKeys<TEventMap>|WILDCARD, bus: Bus<any> = this) {

    this.invalidateCombinedListenerCache();
    if(bus === this) {
      this.invalidateOwnListenerCache();
    } else {
      const currCount = this.delegateListenerCountsByEvent.get(event) ?? 0;
      this.delegateListenerCountsByEvent.set(event, Math.max(currCount - 1, 0));
      this._delegateListenerTotalCount = Math.max(this._delegateListenerTotalCount - 1, 0);
    }

    this.emitLifecycleEvent(Lifecycle.didRemoveListener, event);
    if(this._active && !this.hasListeners()) {
      this._active = false;
      this.emitLifecycleEvent(Lifecycle.idle, null);
    }
  }
}


export interface Bus<TEventMap extends EventMap = EventMap> extends
  ControlSurface<TEventMap>,
  SubscriptionSurface<TEventMap>,
  IntrospectionSurface<TEventMap>,
  MonitoringSurface<TEventMap> {}


/**
 * @ignore
 */
function normalizeScanParams<TEventMap extends EventMap>(
  args: readonly unknown[]
): InternalScanParams<any, TEventMap> {
  const [first, second, third] = args;
  if(
    args.length === 1 &&
    typeof first === 'object' &&
    first !== null &&
    'evaluator' in first &&
    'trigger' in first
  ) {
    return first as InternalScanParams<any, TEventMap>;
  }

  return {
    trigger: first as InternalScanParams<any, TEventMap>['trigger'],
    evaluator: second as InternalScanParams<any, TEventMap>['evaluator'],
    ...(third as ScanOptions | undefined)
  };
}

/**
 * @ignore
 */
function addListener<TKey>(bus: Map<TKey, Set<GenericHandler>>, event: TKey, handler: GenericHandler): {added: boolean, first: boolean} {
  if(!handler) {
    return {added: false, first: false};
  }

  const prevSet = bus.get(event);
  const newSet = new Set<GenericHandler>(prevSet);
  const first: boolean = Boolean(prevSet);
  newSet.add(handler);
  bus.set(event, newSet);
  return {added: true, first};
}

/**
 * @ignore
 */
function removeListener<TKey>(bus: Map<TKey, Set<GenericHandler>>, event: TKey, handler: GenericHandler): {removed: boolean, last: boolean} {
  const set = bus.get(event);
  if(!set) {
    return {removed: false, last: false};
  }
  let last: boolean = false;
  const {size} = set;
  const removed: boolean = set.delete(handler);
  if(set.size === 0) {
    bus.delete(event);
    last = size > 0;
  }
  return {removed, last};
}
