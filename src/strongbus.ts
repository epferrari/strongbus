
import {autobind} from 'core-decorators';
import {type CancelablePromise, cancelable, timeout} from 'jaasync';

import {Scanner} from './scanner';
import {normalizeScanParams, ScannerPools, type ScanParams} from './scannerPools';
import {StrongbusLogger} from './strongbusLogger';
import {LifecycleManager, type LifecycleHost} from './lifecycleManager';
import {type Subscription, type EventMap, WILDCARD} from './types/events';
import type {EventHandler, EventSink, PipeSink, GenericHandler} from './types/eventHandlers';
import type {Logger} from './types/logger';
import {
  resolveDuplicateSubscriptionStrategy,
  type Options,
  type MaterializedBusOptions,
  type ListenerThresholds,
  type ConfigurableBusOptions
} from './types/options';
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
import {subscribeListenable} from './utils/subscribeListenable';
import {INTERNAL_PROMISE} from './utils/internalPromiseSymbol';
import {isSubscribeOptions} from './utils/isSubscribeOptions';
import {Forwards} from './forwards';
import {DownstreamManager, type DownstreamHost} from './downstreamManager';
import {IntrospectionManager} from './introspectionManager';
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

  private readonly forwards = new Forwards();
  private readonly subscriptions!: SubscriptionManager<TEventMap>;
  private readonly downstream!: DownstreamManager<TEventMap>;
  private readonly introspection!: IntrospectionManager<TEventMap>;
  private readonly scanners = new ScannerPools<TEventMap>();
  // set on-construct
  private readonly options!: MaterializedBusOptions;
  private readonly logger!: StrongbusLogger<TEventMap>;
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
    this.downstream = new DownstreamManager({
      host: this.createDownstreamHost(),
      lifecycle: this.lifecycle
    });
    this.introspection = new IntrospectionManager({
      subscriptions: this.subscriptions,
      downstream: this.downstream
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
      handled = this.downstream.propagate(event, payload) || handled;
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

    return this.scanners.scan<any>(this, scanParams);
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
    }
    return this.downstream.pipe(dest, options) as Bus<any>;
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
      this.downstream.unpipe(dest);
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
   * Remove all event subscribers, lifecycle subscribers, and downstreams.
   * Triggers lifecycle meta events for all subscribed events before removing
   * lifecycle subscribers, emitting {@link Lifecycle.willDestroy} during teardown.
   */
  public destroy() {
    this.subscriptions.releaseAll();
    this.lifecycle.destroy();
    this.downstream.releaseAll();
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

  private createDownstreamHost(): DownstreamHost<TEventMap> {
    return {
      is: (target) => target === (this as any),
      getCombinedListenersMap: (target, includeIncognito) =>
        (target as Bus<TEventMap>).getCombinedListenersMap(includeIncognito),
      invalidateCombinedListenerCache: this.invalidateCombinedListenerCache
    };
  }

  private getCombinedListenersMap(
    includeIncognito = false
  ): ReadonlyMap<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>> {
    return this.introspection.getCombinedListenersMap(includeIncognito);
  }

  private accountForDownstreamListeners(_event: EventKeys<TEventMap>|WILDCARD, _count: number): void {
    this.invalidateCombinedListenerCache();
  }

  private accountForRemovedDownstreamListeners(_event: EventKeys<TEventMap>|WILDCARD, _count: number): void {
    this.invalidateCombinedListenerCache();
  }

  private invalidateCombinedListenerCache(): void {
    this.introspection.invalidateCombinedListenerCache();
  }

  private invalidateOwnListenerCache(): void {
    this.introspection.invalidateOwnListenerCache();
  }
}
