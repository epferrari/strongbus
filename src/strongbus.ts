
import {autobind} from 'core-decorators';
import {type CancelablePromise, cancelable, timeout} from 'jaasync';

import {Scanner} from './scanner';
import {normalizeScanParams, ScannerPools, type ScanParams} from './scannerPools';
import {StrongbusLogger, StrongbusLogMessages} from './strongbusLogger';
import {LifecycleManager, type LifecycleHost} from './lifecycleManager';
import {type Subscription, type EventMap, WILDCARD} from './types/events';
import type {
  EventHandler,
  EventSink,
  TapHandler,
  PipePredicate,
  GenericHandler
} from './types/eventHandlers';
import type {Logger} from './types/logger';
import {
  type Options,
  type ListenerThresholds,
  type ConfigurableBusOptions
} from './types/options';
import {
  type MaterializedBusOptions,
  DEFAULT_NAME,
  uniqueName,
  resolveDuplicateSubscriptionStrategy
} from './types/materializedBusOptions';
import {ListenerScope, type IntrospectionOptions} from './types/listenerScope';
import type {
  SubscriptionSurface,
  SubscriptionSurfaceAny,
  SubscriptionSurfaceNext,
  SubscriptionSurfacePipe,
  SubscriptionSurfaceScan,
  SubscriptionSurfaceTap,
  SubscriptionSurfaceUnpipe,
  FilteredPipeHandle,
  NextResult,
  SubscribeOptions
} from './types/surfaces/subscriptionSurface';
import type {ControlSurface} from './types/surfaces/controlSurface';
import type {EmittingSurface} from './types/surfaces/emittingSurface';
import type {
  IntrospectionSurface,
  IntrospectionSurfaceHasListenersForEvent,
  IntrospectionSurfaceListenerCountForEvent,
  IntrospectionSurfaceListenerForEach,
  IntrospectionSurfaceListenerForEvent
} from './types/surfaces/introspectionSurface';
import type {MonitoringSurface, MonitoringHook} from './types/surfaces/monitoringSurface';
import type {EventKeys, SubscribableEventKeys, VoidEventKeys} from './types/utility';
import {subscribeListenable} from './utils/subscribeListenable';
import {subscriptionWrapper} from './utils/subscriptionWrapper';
import {INTERNAL_PROMISE} from './utils/internalPromiseSymbol';
import {isSubscribeOptions} from './utils/isSubscribeOptions';
import {BusGraphNode} from './busGraphNode';
import {IntrospectionManager, type IntrospectionHost} from './introspectionManager';
import {SubscriptionManager, type SubscriptionHost} from './subscriptionManager';
import {EventDispatcher, type EventDispatcherHost} from './eventDispatcher';



export interface Bus<TEventMap extends EventMap = EventMap> extends
  ControlSurface<TEventMap>,
  EmittingSurface<TEventMap>,
  SubscriptionSurface<TEventMap>,
  IntrospectionSurface<TEventMap>,
  MonitoringSurface<TEventMap> {}

@autobind
export class Bus<TEventMap extends EventMap = EventMap> extends BusGraphNode<TEventMap> implements
  ControlSurface<TEventMap>,
  EmittingSurface<TEventMap>,
  SubscriptionSurface<TEventMap>,
  IntrospectionSurface<TEventMap>,
  MonitoringSurface<TEventMap> {

  private static defaultOptions: MaterializedBusOptions = {
    name: DEFAULT_NAME,
    thresholds: {
      info: 100,
      warn: 500,
      error: Infinity
    },
    verbose: false,
    coalesceDownstreamLifecycleEvents: true,
    duplicateSubscriptionStrategy: resolveDuplicateSubscriptionStrategy(),
    onUnhandledEvent: 'ignore',
    onUseAfterDestroy: false
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
   * @deprecated Use {@link Bus.configure} with `onUnhandledEvent` instead.
   */
  public static set defaultAllowUnhandledEvents(allow: boolean) {
    Bus.configure({onUnhandledEvent: allow ? 'ignore' : 'throw'});
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
  private static readonly DESTROYED: unique symbol = Symbol('destroyed');

  /**
   * What a bus's collaborators need from it. A class rather than a literal so its methods are shared
   * by every bus; declared inside {@link Bus} so it can reach members that are not public.
   */
  private static readonly Host = class<T extends EventMap> implements
    LifecycleHost<T>,
    SubscriptionHost,
    IntrospectionHost<T>,
    EventDispatcherHost<T> {
    private readonly bus: Bus<T>;

    constructor(bus: Bus<T>) {
      this.bus = bus;
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

    public getListenerCountForUpTo(event: EventKeys<T>|WILDCARD, cap: number): number {
      return this.bus.introspection.getListenerCountForUpTo(event, cap);
    }

    // local invalidation is enough here: the bus where the change started has already walked
    // every upstream, this one included
    public accountForDownstreamListeners(_event: EventKeys<T>|WILDCARD, _count: number): void {
      this.bus.introspection.invalidateCombinedListenerCache();
    }

    public accountForRemovedDownstreamListeners(_event: EventKeys<T>|WILDCARD, _count: number): void {
      this.bus.introspection.invalidateCombinedListenerCache();
    }

    public invalidateOwnListenerCache(): void {
      this.bus.introspection.invalidateOwnListenerCache();
    }

    public invalidateListenerCachesUpstream(): void {
      this.bus.invalidateListenerCachesUpstream();
    }

    public hasDownstream(): boolean {
      return this.bus.hasDownstream();
    }

    public someDownstream(
      includeIncognito: boolean,
      fn: (downstream: IntrospectionManager<T>) => boolean
    ): boolean {
      return this.bus.someDownstream(includeIncognito, fn);
    }

    public forEachDownstream(fn: Parameters<IntrospectionHost<T>['forEachDownstream']>[0]): void {
      this.bus.forEachDownstream(fn);
    }

    public propagate<K extends EventKeys<T>>(
      event: K,
      payload: T[K] | undefined,
      fromUpstream: boolean
    ): boolean {
      return this.bus.propagate(event, payload, fromUpstream);
    }
  };

  public readonly name!: string;
  public readonly hook!: MonitoringHook<TEventMap>;

  protected readonly options!: MaterializedBusOptions;
  protected readonly logger!: StrongbusLogger<TEventMap>;
  protected readonly lifecycle!: LifecycleManager<TEventMap>;
  protected readonly dispatcher!: EventDispatcher<TEventMap>;
  protected readonly introspection!: IntrospectionManager<TEventMap>;
  private readonly subscriptions!: SubscriptionManager<TEventMap>;
  private readonly scanners!: ScannerPools<TEventMap>;
  private readonly host = new Bus.Host<TEventMap>(this);
  /** Pending `next` / `scan` promises, mapped to whether they were registered incognito. */
  private readonly inFlight = new Map<CancelablePromise<unknown>, boolean>();
  private destroyReason: string | typeof Bus.DESTROYED | undefined;
  /** `true` only while {@link Bus.destroy} is running, including its lifecycle hooks. */
  private destroying: boolean = false;

  constructor(options?: Options) {
    super();
    this.options = Bus.mergeOptions(Bus.defaultOptions, options);
    this.name = `${uniqueName(this.options.name)} ${this.constructor.name}`;
    this.logger = new StrongbusLogger<TEventMap>({
      name: this.name,
      provider: this.options.logger,
      thresholds: this.options.thresholds,
      verbose: this.options.verbose
    });
    this.lifecycle = new LifecycleManager<TEventMap>({
      host: this.host,
      options: this.options,
      logger: this.logger
    });
    this.hook = ((event, handler) => {
      if(this.guard('hook')) {
        return inertSubscription();
      }
      return this.lifecycle.hook(event, handler);
    }) as MonitoringHook<TEventMap>;
    this.subscriptions = new SubscriptionManager({
      host: this.host,
      options: this.options,
      logger: this.logger,
      lifecycle: this.lifecycle
    });
    this.introspection = new IntrospectionManager({
      subscriptions: this.subscriptions,
      host: this.host
    });
    this.scanners = new ScannerPools<TEventMap>();
    this.dispatcher = new EventDispatcher<TEventMap>({
      subscriptions: this.subscriptions,
      host: this.host,
      options: this.options
    });
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
    if(this.ignoresCalls) {
      return false;
    }
    return this.dispatcher.dispatchEvent(event, payload);
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
    if(this.guard('on')) {
      return inertSubscription();
    }
    return this.subscriptions.on(event, handler, options);
  }

  /**
   * Remove a handler previously registered with {@link Bus.on}.
   * Pass the same function reference; no-op if that handler is not registered for `event`.
   * Honors `duplicateSubscriptionStrategy.disposal` (`collapse` clears all stacked `on` intent;
   * `stack` pops the oldest frame — head of the stack). Does not remove {@link Bus.once} /
   * {@link Bus.any} / {@link Bus.tap} intent.
   */
  public off<T extends SubscribableEventKeys<TEventMap>>(event: T, handler: EventHandler<TEventMap, T>): void {
    if(this.guard('off')) {
      return;
    }
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
    if(this.guard('once')) {
      return inertSubscription();
    }
    return this.subscriptions.once(event, handler, options);
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
    if(this.guard('any')) {
      return inertSubscription();
    }
    return this.subscriptions.any(
      events as EventKeys<TEventMap>[],
      handler as unknown as EventSink<TEventMap>,
      options
    );
  }) as SubscriptionSurfaceAny<TEventMap>;

  /**
   * Observe every raised event as a correlated `{event, payload}` message.
   * Does not create a graph edge. Unsubscribe via the returned {@link Subscription}.
   */
  public tap: SubscriptionSurfaceTap<TEventMap> = ((
    handler: TapHandler<TEventMap>,
    options?: SubscribeOptions
  ) => {
    if(this.guard('tap')) {
      return inertSubscription();
    }
    return this.subscriptions.tap(handler, options);
  }) as SubscriptionSurfaceTap<TEventMap>;

  /**
   * Attach a graph edge to another {@link Bus}, or return a {@link FilteredPipeHandle}
   * when given a {@link PipePredicate} for gated multi-hop relay.
   *
   * - `pipe(dest)` — first-hop / local raises always deliver to `dest`.
   * - `pipe(predicate).pipe(dest)` — stores `predicate` on the edge; passthrough (upstream-sourced)
   *   events are delivered only when `predicate` returns true. Unfiltered outbound edges from
   *   a bus that already has inbound pipes warn once per unique unsound path and block passthrough.
   *
   * Requires a real {@link Bus} instance — not a hand-rolled surface duck type.
   */
  public pipe: SubscriptionSurfacePipe<TEventMap> = ((
    dest: PipePredicate<TEventMap> | Bus<any>,
    options?: SubscribeOptions
  ): FilteredPipeHandle<TEventMap> | Bus<any> => {
    if(this.guard('pipe')) {
      return typeof dest === 'function' ? inertFilteredPipeHandle() : dest;
    } else if(typeof dest === 'function') {
      return this.createFilteredPipeHandle(dest as PipePredicate<TEventMap>);
    } else if(dest.guardAsPipeTarget(this.name)) {
      return dest;
    }
    return this.connectDownstreamNode(dest, options) as Bus<any>;
  }) as SubscriptionSurfacePipe<TEventMap>;

  /**
   * Stop piping events into a bus previously passed to {@link Bus.pipe}.
   */
  public unpipe: SubscriptionSurfaceUnpipe<TEventMap> = ((
    dest: Bus<any>
  ) => {
    if(this.guard('unpipe')) {
      return;
    }
    this.disconnectDownstreamNode(dest);
  }) as SubscriptionSurfaceUnpipe<TEventMap>;

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
    const stub = this.guardPromise<TResult>('next');
    if(stub) {
      return stub;
    }
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

    return this.trackInFlight(p, options?.incognito === true);
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
   *   No timer is scheduled if the scan settles during eager evaluation.
   * @param options.eager - call the evaluator immediately; default `true`.
   *   This eliminates the anti-pattern of guarding `scan` with `if (!condition)`.
   */
  public scan: SubscriptionSurfaceScan<TEventMap> = ((
    ...args: unknown[]
  ): CancelablePromise<any> => {
    const stub = this.guardPromise('scan');
    if(stub) {
      return stub;
    }
    const params = normalizeScanParams<TEventMap>(args);
    const scanParams = params as unknown as ScanParams<any, TEventMap>;

    const subscribeOptions: SubscribeOptions | undefined = params.incognito
      ? {incognito: true}
      : undefined;

    if(params.timeout && params.timeout > 0) {
      const scanner = new Scanner<any>(scanParams);
      scanner.scan<TEventMap>(this, params.trigger, subscribeOptions);
      if(scanner.settled) {
        // eager evaluation already settled the scan; a timer would never fire
        // tslint:disable-next-line:prefer-object-spread
        return Object.assign(
          scanner,
          {[INTERNAL_PROMISE]: scanner}
        );
      }
      // tslint:disable-next-line:prefer-object-spread
      return this.trackInFlight(Object.assign(
        timeout(scanner, {ms: params.timeout, cancelUnderlyingPromiseOnTimeout: true}),
        {
          [INTERNAL_PROMISE]: scanner,
          cancel: (err: any) => scanner.cancel(err)
        }
      ), params.incognito === true);
    } else if(params.pool === false) {
      const scanner = new Scanner<any>(scanParams);
      scanner.scan<TEventMap>(this, params.trigger, subscribeOptions);
      // tslint:disable-next-line:prefer-object-spread
      return this.trackInFlight(Object.assign(
        scanner,
        {[INTERNAL_PROMISE]: scanner}
      ), params.incognito === true);

    }

    return this.trackInFlight(this.scanners.scan<any>(this, scanParams), params.incognito === true);
  }) as SubscriptionSurfaceScan<TEventMap>;

  /**
   * Subscribe to meta states of the {@link Bus}, `idle` and `active`.
   * Bus becomes idle when it goes from 1 to 0 subscribers, and active when it goes from 0 to 1.
   * The handler receives a `boolean` indicating if the bus is active (`true`) or idle (`false`)
   */
  public monitor(handler: (activeState: boolean) => void): Subscription {
    if(this.guard('monitor')) {
      return inertSubscription();
    }
    return this.lifecycle.monitor(handler);
  }

  /**
   * The active state of the bus, i.e. does it have any subscribers. Subscribers include downstreams and scanners.
   */
  public get active(): boolean {
    return this.lifecycle.active;
  }

  /**
   * Whether the bus has any listeners in `options.scope` (defaults to `ListenerScope.ANY`).
   */
  public hasListeners(options: IntrospectionOptions = {}): boolean {
    return this.introspection.hasListeners(options);
  }

  /**
   * Total handler registrations in `options.scope` (defaults to `ListenerScope.ANY`).
   * For `ListenerScope.ANY`, sums own and downstream counts (the same handler on both
   * still counts twice).
   */
  public getListenerCount(options: IntrospectionOptions = {}): number {
    return this.introspection.getListenerCount(options);
  }

  public getListeners(options: IntrospectionOptions = {}): ReadonlySet<GenericHandler> {
    return this.introspection.getListeners(options);
  }

  public getEventCount(options: IntrospectionOptions = {}): number {
    return this.introspection.getEventCount(options);
  }

  public hasListenersFor: IntrospectionSurfaceHasListenersForEvent<TEventMap> = ((
    event,
    options: IntrospectionOptions = {}
  ) => {
    return this.introspection.hasListenersFor(event, options);
  }) as IntrospectionSurfaceHasListenersForEvent<TEventMap>;

  public getListenerCountFor: IntrospectionSurfaceListenerCountForEvent<TEventMap> = ((
    event,
    options: IntrospectionOptions = {}
  ) => {
    return this.introspection.getListenerCountFor(event, options);
  }) as IntrospectionSurfaceListenerCountForEvent<TEventMap>;

  public getListenersFor: IntrospectionSurfaceListenerForEvent<TEventMap> = ((
    event,
    options: IntrospectionOptions = {}
  ) => {
    return this.introspection.getListenersFor(event, options);
  }) as IntrospectionSurfaceListenerForEvent<TEventMap>;

  public forEach: IntrospectionSurfaceListenerForEach<TEventMap> = ((
    fn,
    options: IntrospectionOptions = {}
  ) => {
    return this.introspection.forEach(fn, options);
  }) as IntrospectionSurfaceListenerForEach<TEventMap>;

  /**
   * Whether {@link Bus.destroy} has been called. Becomes `true` once teardown completes,
   * so it is still `false` inside {@link Lifecycle.willDestroy} hooks.
   */
  public get destroyed(): boolean {
    return this.destroyReason !== undefined;
  }

  /**
   * Remove all event subscribers, lifecycle subscribers, and downstreams, and detach
   * from every upstream that pipes into this bus.
   * Triggers lifecycle meta events for all subscribed events before removing
   * lifecycle subscribers, emitting {@link Lifecycle.willDestroy} during teardown.
   * The first `reason` given is retained and reported by {@link Options.onUseAfterDestroy}.
   *
   * Not reentrant. While teardown runs, `destroy` and `clear` are ignored, and the methods
   * {@link Options.onUseAfterDestroy} guards are ignored with a debug log under any setting;
   * `next` / `scan` return an already-canceled promise. `emit` still runs.
   */
  public destroy(reason?: string) {
    if(this.destroying || this.ignoresCalls) {
      return;
    }
    this.destroying = true;
    try {
      this.subscriptions.releaseAll();
      this.lifecycle.destroy();
      this.releaseAllDownstreamEdges();
      this.releaseAllUpstreamEdges();
      this.destroyReason ??= reason ?? Bus.DESTROYED;
    } finally {
      this.destroying = false;
    }
  }

  /**
   * Remove listeners and pipe edges without destroying the bus. Unlike {@link Bus.destroy},
   * lifecycle hooks stay registered (and see the removals), and the bus remains usable.
   *
   * - `ListenerScope.OWN` cancels pending {@link Bus.next} / {@link Bus.scan} promises and
   *   removes this bus's event subscribers.
   * - `ListenerScope.DOWNSTREAM` severs edges to buses this bus pipes into.
   * - `ListenerScope.ANY` does both, and also detaches from upstreams that pipe into this bus.
   *
   * @param options.scope - default `ListenerScope.ANY`
   * @param options.includeIncognito - when `false`, incognito subscriptions, `next` / `scan`
   *   promises, and pipe edges are left in place. Default `true`.
   */
  public clear(options: IntrospectionOptions = {}): void {
    if(this.destroying || this.ignoresCalls) {
      return;
    }
    const {scope = ListenerScope.ANY, includeIncognito = true} = options;
    if((scope & ListenerScope.OWN) === ListenerScope.OWN) {
      for(const [p, incognito] of [...this.inFlight]) {
        if(includeIncognito || !incognito) {
          p.cancel(`${this.name} cleared`);
        }
      }
      this.subscriptions.releaseAll(includeIncognito);
    }
    if((scope & ListenerScope.DOWNSTREAM) === ListenerScope.DOWNSTREAM) {
      this.disconnectAllDownstreamNodes(includeIncognito);
    }
    if((scope & ListenerScope.ANY) === ListenerScope.ANY) {
      this.releaseAllUpstreamEdges(includeIncognito);
    }
  }

  private trackInFlight<P extends CancelablePromise<any>>(p: P, incognito: boolean): P {
    const untrack = () => {
      this.inFlight.delete(p);
    };
    this.inFlight.set(p, incognito);
    p.then(untrack, untrack);
    return p;
  }

  private createFilteredPipeHandle(
    filter: PipePredicate<TEventMap>
  ): FilteredPipeHandle<TEventMap> {
    return {
      pipe: ((downstream: Bus<any>, options?: SubscribeOptions) => {
        if(this.guard('pipe') || downstream.guardAsPipeTarget(this.name)) {
          return downstream;
        }
        return this.connectDownstreamNode(downstream, {...options, filter}) as Bus<any>;
      }) as FilteredPipeHandle<TEventMap>['pipe']
    };
  }

  /**
   * Under {@link Options.onUseAfterDestroy}, report a call to `method` on a destroyed bus.
   * Calls made while {@link Bus.destroy} is running are logged at debug under any setting.
   * @returns `true` when the caller should return its inert stub instead of running
   */
  private guard(method: string): boolean {
    if(this.guardDuringDestroy(method)) {
      return true;
    }
    const {onUseAfterDestroy} = this.options;
    if(!onUseAfterDestroy || !this.destroyed) {
      return false;
    }
    const reason = this.destroyReason === Bus.DESTROYED ? undefined : this.destroyReason;
    if(onUseAfterDestroy === 'throw') {
      const {message, code} = StrongbusLogMessages.useAfterDestroy(this.name, method, reason);
      throw Object.assign(new Error(message), {code});
    }
    this.logger.onUseAfterDestroy(method, reason, onUseAfterDestroy);
    return true;
  }

  /**
   * Whether {@link Options.onUseAfterDestroy} skips calls now, without reporting them.
   * Used by `emit`, `destroy`, and `clear`, which skip silently.
   */
  private get ignoresCalls(): boolean {
    return Boolean(this.options.onUseAfterDestroy) && this.destroyed;
  }

  /**
   * {@link Bus.guard} for an upstream piping into this bus, reported under
   * this bus's {@link Options.onUseAfterDestroy}.
   */
  private guardAsPipeTarget(upstreamName: string): boolean {
    return this.guard(`${upstreamName}.pipe`);
  }

  /**
   * {@link Bus.guard} for promise-returning methods: under `'throw'`, rejects
   * rather than throwing synchronously.
   * @returns the stub to return, or `null` when the caller should run
   */
  private guardPromise<T>(method: string): CancelablePromise<T> | null {
    if(this.guardDuringDestroy(method)) {
      return canceledPromise<T>(`${this.name} destroyed`);
    }
    try {
      return this.guard(method) ? pendingPromise<T>() : null;
    } catch(e) {
      return cancelable<T>(() => Promise.reject(e));
    }
  }

  private guardDuringDestroy(method: string): boolean {
    if(this.destroying) {
      this.logger.onUseDuringDestroy(method);
    }
    return this.destroying;
  }

}

function inertSubscription(): Subscription {
  return subscriptionWrapper(() => undefined);
}

function inertFilteredPipeHandle<TEventMap extends EventMap>(): FilteredPipeHandle<TEventMap> {
  return {
    pipe: ((downstream: Bus<any>) => downstream) as FilteredPipeHandle<TEventMap>['pipe']
  };
}

/** Never settles on its own; `cancel()` still rejects it. */
function pendingPromise<T>(): CancelablePromise<T> {
  return cancelable<T>(() => new Promise<T>(() => undefined));
}

/** Rejected the same way {@link Bus.destroy} cancels pending `next` / `scan` promises. */
function canceledPromise<T>(reason: string): CancelablePromise<T> {
  const p = pendingPromise<T>();
  p.catch((): void => undefined);
  p.cancel(reason);
  return p;
}
