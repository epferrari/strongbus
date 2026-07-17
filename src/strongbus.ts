
import {autobind} from 'core-decorators';
import {type CancelablePromise, cancelable, timeout} from 'jaasync';

import {Scanner} from './scanner';
import {ScannerPools, type ScanParams as InternalScanParams} from './scannerPools';
import {StrongbusLogger} from './strongbusLogger';
import {DownstreamSnapshot, LifecycleManager} from './lifecycleManager';
import type {LifecycleHost} from './types/lifecycleHost';
import {type Subscription, type EventMap, WILDCARD} from './types/events';
import type {EventHandler, EventSink, PipeSink, PipeMessage, PipeForward, GenericHandler} from './types/eventHandlers';
import {Lifecycle} from './types/lifecycle';
import type {Logger} from './types/logger';
import type {Options, ListenerThresholds, ConfigurableBusOptions} from './types/options';
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
  ScanOptions,
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
import {subscriptionWrapper} from './utils/subscriptionWrapper';
import {subscribeListenable} from './utils/subscribeListenable';
import {INTERNAL_PROMISE} from './utils/internalPromiseSymbol';

type ResolvedBusOptions = Required<Options> & {thresholds: Required<ListenerThresholds>};

@autobind
export class Bus<TEventMap extends EventMap = EventMap> implements
  ControlSurface<TEventMap>,
  SubscriptionSurface<TEventMap>,
  IntrospectionSurface<TEventMap>,
  MonitoringSurface<TEventMap> {

  private static defaultOptions: ResolvedBusOptions = {
    name: 'Anonymous',
    allowUnhandledEvents: true,
    thresholds: {
      info: 100,
      warn: 500,
      error: Infinity
    },
    logger: console,
    verbose: false,
    coalesceDownstreamLifecycleEvents: true
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
    base: ResolvedBusOptions,
    overrides: Partial<Options> = {}
  ): ResolvedBusOptions {
    return {
      ...base,
      ...overrides,
      thresholds: {
        ...base.thresholds,
        ...overrides.thresholds
      }
    };
  }

  private readonly downstreams = new Map<Bus<TEventMap>, {
    unlink: VoidFunction;
    incognito: boolean;
  }>();
  private readonly downstreamListenerCountsByEvent = new Map<EventKeys<TEventMap>|WILDCARD, number>();
  private readonly sinks = new WeakMap<PipeSink<TEventMap>, Subscription>();
  /**
   * Live disposer index: handler → event → Subscription.
   * Duplicate {@link Bus.on} with the same handler returns the same Subscription;
   * {@link Bus.off} is O(1) via this map.
   */
  private readonly subscriptionsByHandler = new Map<
    GenericHandler,
    Map<EventKeys<TEventMap>|WILDCARD, Subscription>
  >();
  /**
   * Incognito registrations keyed like {@link subscriptionsByHandler}:
   * handler → set of events registered with `{incognito: true}`.
   */
  private readonly incognitoByHandler = new Map<
    GenericHandler,
    Set<EventKeys<TEventMap>|WILDCARD>
  >();
  private readonly handlersByEvent = new Map<EventKeys<TEventMap>|WILDCARD, Set<GenericHandler>>();
  private readonly scannerPools = new ScannerPools<TEventMap>();
  // queue of unsubscription requests so that they are processed transactionally in order
  private readonly unsubQueue: {
    subscription: Subscription;
    event: EventKeys<TEventMap>|WILDCARD;
    handler: GenericHandler;
  }[] = [];

  // volatile internal state
  private _purgingUnsubQueue: boolean = false;
  private _downstreamListenerTotalCount: number = 0;
  private _cachedCombinedListeners: Map<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>>;
  private _cachedCombinedListenersWithIncognito: Map<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>>;
  private _cachedOwnListeners: Map<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>>;
  private _cachedOwnListenersWithIncognito: Map<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>>;
  private _cachedDownstreamListeners: Map<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>>;
  private _cachedDownstreamListenersWithIncognito: Map<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>>;

  // set on-construct
  private readonly options!: ResolvedBusOptions;
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
      logger: this.logger,
      coalesceDownstreamLifecycleEvents: this.options.coalesceDownstreamLifecycleEvents
    });
    this.hook = this.lifecycle.hook;
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
   * Calling again with the same `event` and handler reference is a no-op and returns
   * the existing {@link Subscription}.
   */
  public on<T extends SubscribableEventKeys<TEventMap>>(
    event: T,
    handler: EventHandler<TEventMap, T>,
    options?: SubscribeOptions
  ): Subscription {
    return this.addListener(event, handler, options);
  }

  /**
   * Remove a handler previously registered with {@link Bus.on}.
   * Pass the same function reference; no-op if that handler is not registered for `event`.
   * Does not remove wrappers from {@link Bus.once}, {@link Bus.any}, or {@link Bus.pipe}.
   */
  public off<T extends SubscribableEventKeys<TEventMap>>(event: T, handler: EventHandler<TEventMap, T>): void {
    this.subscriptionsByHandler.get(handler)?.get(event)?.();
  }

  /**
   * Subscribe a callback to an event. Automatically unsubscribes after the first invocation.
   */
  public once<T extends SubscribableEventKeys<TEventMap>>(
    event: T,
    handler: EventHandler<TEventMap, T>,
    options?: SubscribeOptions
  ): Subscription {
    let sub: Subscription;
    const wrapper = ((payload: TEventMap[T]) => {
      sub();
      handler(payload);
    }) as GenericHandler;
    sub = this.addListener(event, wrapper, options);
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
    handler,
    options?: SubscribeOptions
  ) => {
    return subscriptionWrapper(over(
      (events as EventKeys<TEventMap>[]).map((e) => {
        const anyHandler = (payload: TEventMap[typeof e]) => handler(e as EventKeys<AnyEventMap<TEventMap>>, payload as any);
        return this.addListener(e, anyHandler, options);
      })
    ));
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
    const scanParams = params as unknown as InternalScanParams<any, TEventMap>;

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
   * function bound to that message. `forward(dst)` re-emits the whole message on a
   * payload-compatible bus without a downstream link.
   *
   * Bus-to-bus piping returns the downstream bus (for chaining), and requires a real
   * {@link Bus} instance — not a hand-rolled surface duck type.
   */
  public pipe: SubscriptionSurfacePipe<TEventMap> = ((
    dest: PipeSink<TEventMap> | Bus<any>,
    options?: SubscribeOptions
  ): Subscription | Bus<any> => {
    if(typeof dest === 'function') {
      const sink = dest as PipeSink<TEventMap>;
      const wrapper: GenericHandler = (event, payload) => {
        const forward = ((target: {emit: (e: any, p: any) => boolean}) =>
          target.emit(event, payload)) as PipeForward<TEventMap>;
        sink({event, payload} as PipeMessage<TEventMap>, forward);
      };
      this.sinks.set(sink, this.addListener(WILDCARD, wrapper, options));
      return subscriptionWrapper(() => this.unpipe(sink));
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
      this.sinks.get(dest as PipeSink<TEventMap>)?.();
      this.sinks.delete(dest as PipeSink<TEventMap>);
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
    return this.registryForScope(scope, includeIncognito).getCount(event);
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
      for(const [event, listeners] of this.handlersByEvent) {
        const filtered = includeIncognito
          ? new Set(listeners)
          : new Set([...listeners].filter(handler => !this.isIncognito(handler, event)));
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
    this.releaseSubscribers();
    this.lifecycle.destroy();
    this.releaseDownstreams();
  }

  private releaseSubscribers(): void {
    // any un-invoked unsubscribes will be invoked,
    // their lifecycle hooks will be triggered,
    // and they will be removed from the index
    const pending: Subscription[] = [];
    for(const byEvent of this.subscriptionsByHandler.values()) {
      for(const sub of byEvent.values()) {
        pending.push(sub);
      }
    }
    over(pending)();
    this.handlersByEvent.clear();
    this.incognitoByHandler.clear();
  }

  private releaseDownstreams(): void {
    for(const link of this.downstreams.values()) {
      link.unlink();
    }
    this.downstreams.clear();
  }

  private addListener(
    event: EventKeys<TEventMap>|WILDCARD,
    handler: GenericHandler,
    options?: SubscribeOptions
  ): Subscription {
    const existing = this.subscriptionsByHandler.get(handler)?.get(event);
    if(existing) {
      return existing;
    }

    const incognito = options?.incognito === true;
    const n: number = (this.handlersByEvent.get(event)?.size ?? 0) + 1;
    this.logger.onAddListener(event, n);
    if(!incognito) {
      this.lifecycle.ownListenerWillAdd(event);
    }
    const {added} = addListener(this.handlersByEvent, event, handler);
    if(added) {
      if(incognito) {
        this.markIncognito(handler, event);
      }
      this.invalidateCombinedListenerCache();
      this.invalidateOwnListenerCache();
      if(!incognito) {
        this.lifecycle.ownListenerDidAdd(event);
      }
    }
    return this.generateListenerSubscription(event as EventKeys<TEventMap>, handler);
  }

  private generateListenerSubscription(event: EventKeys<TEventMap>|WILDCARD, handler: GenericHandler): Subscription {
    let byEvent = this.subscriptionsByHandler.get(handler);
    if(!byEvent) {
      byEvent = new Map();
      this.subscriptionsByHandler.set(handler, byEvent);
    }

    const sub = subscriptionWrapper(() => {
      this.unsubQueue.push({
        subscription: sub,
        event,
        handler
      });
      this.purgeUnsubQueue();
    });
    byEvent.set(event, sub);
    return sub;
  }

  private purgeUnsubQueue() {
    if(this._purgingUnsubQueue) {
      return;
    }

    this._purgingUnsubQueue = true;

    while(this.unsubQueue.length) {
      const {subscription, event, handler} = this.unsubQueue.shift();
      const byEvent = this.subscriptionsByHandler.get(handler);
      if(byEvent?.get(event) !== subscription) {
        continue;
      }

      byEvent.delete(event);
      if(byEvent.size === 0) {
        this.subscriptionsByHandler.delete(handler);
      }
      // lifecycle events may trigger additional unsubs, which will be pushed to the end of queue and handled in a subsequent iteration of this loop
      this.removeListener(event, handler);
    }

    this._purgingUnsubQueue = false;
  }

  private removeListener(event: EventKeys<TEventMap>|WILDCARD, handler: GenericHandler): void {
    const incognito = this.isIncognito(handler, event);
    if(!incognito) {
      this.lifecycle.ownListenerWillRemove(event);
    }
    const {removed} = removeListener(this.handlersByEvent, event, handler);
    if(removed) {
      this.clearIncognito(handler, event);
      this.invalidateCombinedListenerCache();
      this.invalidateOwnListenerCache();
      if(!incognito) {
        this.lifecycle.ownListenerDidRemove(event);
      }
      const count = this.handlersByEvent.get(event)?.size ?? 0;
      this.logger.onListenerRemoved(event, count);
    }
  }

  private isIncognito(
    handler: GenericHandler,
    event: EventKeys<TEventMap>|WILDCARD
  ): boolean {
    return this.incognitoByHandler.get(handler)?.has(event) ?? false;
  }

  private markIncognito(
    handler: GenericHandler,
    event: EventKeys<TEventMap>|WILDCARD
  ): void {
    let events = this.incognitoByHandler.get(handler);
    if(!events) {
      events = new Set();
      this.incognitoByHandler.set(handler, events);
    }
    events.add(event);
  }

  private clearIncognito(
    handler: GenericHandler,
    event: EventKeys<TEventMap>|WILDCARD
  ): void {
    const events = this.incognitoByHandler.get(handler);
    if(!events) {
      return;
    }
    events.delete(event);
    if(events.size === 0) {
      this.incognitoByHandler.delete(handler);
    }
  }

  private emitEvent(event: EventKeys<TEventMap>|WILDCARD, ...args: any[]): boolean {
    const handlers = this.handlersByEvent.get(event);
      if(handlers && handlers.size) {
        for(const fn of handlers) {
          try {
            const execution = fn(...args);

            // emit errors if fn returns promise that rejects
            (execution as Promise<any>)?.catch?.((e) => {
              this.lifecycle.emitHandlerError(e, event);
            });
          } catch(e: unknown) {
            this.lifecycle.emitHandlerError(e, event);
          }
        }
        return true;
      }
      return false;
  }

  private forward<T extends EventKeys<TEventMap>>(event: T, payload?: TEventMap[T]): boolean {
    const {downstreams: _downstreams} = this;
    if(_downstreams.size) {
      return Array.from(_downstreams.keys())
        .reduce((acc, d) => (d.emit(event as any, payload as any) || acc), false);
    } else {
      return false;
    }
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
    return downstreamSnapshotFromListenersMap<TEventMap>(
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
}


export interface Bus<TEventMap extends EventMap = EventMap> extends
  ControlSurface<TEventMap>,
  SubscriptionSurface<TEventMap>,
  IntrospectionSurface<TEventMap>,
  MonitoringSurface<TEventMap> {}


/**
 * @ignore
 */
function isSubscribeOptions(value: unknown): value is SubscribeOptions {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

/**
 * @ignore
 */
function downstreamSnapshotFromListenersMap<TEventMap extends EventMap>(
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
