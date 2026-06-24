
import {autobind} from 'core-decorators';
import {type CancelablePromise, cancelable, timeout} from 'jaasync';

import {Scanner} from './scanner';
import {StrongbusLogger} from './strongbusLogger';
import {type Subscription, type EventMap, type Listenable, WILDCARD} from './types/events';
import type {SingleEventHandler, EventSink, GenericHandler} from './types/eventHandlers';
import {Lifecycle} from './types/lifecycle';
import type {Logger} from './types/logger';
import type {Options, ListenerThresholds} from './types/options';
import type {Scannable} from './types/scannable';
import type {EventKeys, ElementType, EventPayload} from './types/utility';
import {over} from './utils/over';
import {subscriptionWrapper} from './utils/subscriptionWrapper';
import {randomId} from './utils/randomId';
import {subscribeListenable} from './utils/subscribeListenable';
import {INTERNAL_PROMISE} from './utils/internalPromiseSymbol';
import {normalizeError} from './utils/normalizeError';


@autobind
export class Bus<TEventMap extends EventMap = EventMap> implements Scannable<TEventMap> {

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
   * Set the default for Bus.options.allowUnhandledEvents for all instances
   * @setter `boolean`
   */
  public static set defaultAllowUnhandledEvents(allow: boolean) {
    Bus.defaultOptions.allowUnhandledEvents = allow;
  }

  /**
   * Set the default Bus.options.thresholds for all instances
   * @setter Partial<[[ListenerThresholds]]>
   */
  public static set defaultThresholds(thresholds: Partial<ListenerThresholds>) {
    Bus.defaultOptions.thresholds = {
      ...Bus.defaultOptions.thresholds,
      ...thresholds
    };
  }

  /**
   * Set the default Bus.options.verbose for all instances
   * @setter Partial<[[ListenerThresholds]]>
   */
   public static set verbose(verbose: boolean) {
    Bus.defaultOptions.verbose = verbose;
  }

  /**
   * Set the default logger for all instances to an object that implements [[Logger]] interface
   * @setter [[Logger]]
   */
  public static set defaultLogger(logger: Logger) {
    Bus.defaultOptions.logger = logger;
  }

  private _active = false;
  private readonly _delegates = new Map<Bus<TEventMap>, Subscription[]>();
  private readonly _delegateListenerCountsByEvent = new Map<EventKeys<TEventMap>|WILDCARD, number>();
  private _delegateListenerTotalCount: number = 0;
  private readonly _eventSinks = new WeakMap<EventSink<TEventMap>, Subscription>();
  private readonly subscriptionCache = new Map<string, Subscription>();
  private readonly options: Required<Options> & {thresholds: Required<ListenerThresholds>};

  private readonly bus = new Map<EventKeys<TEventMap>|WILDCARD, Set<GenericHandler>>();
  private readonly lifecycle = new Map<Lifecycle, Set<GenericHandler>>();

  private readonly logger: StrongbusLogger<TEventMap>;

  // queue of unsubscription requests so that they are processed transactionally in order
  private readonly _unsubQueue: {
    token: string;
    event: EventKeys<TEventMap>|WILDCARD;
    handler: GenericHandler;
  }[] = [];
  private _purgingUnsubQueue: boolean = false;

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
  }

  /**
   * @override
   * Declare how the bus should handle events emitted that have no listeners.
   * Will be invoked when an instance's `options.allowUnhandledEvents = false` (default is true).
   * The default implementation is to throw an error.
   */
  protected handleUnexpectedEvent<T extends EventKeys<TEventMap>>(
    event: T,
    ...payload: TEventMap[T] extends void
      ? ([] | [null] | [undefined])
      : [TEventMap[T]]
  ) {
    const errorMessage = [
      `Strongbus.Bus received unexpected message type '${String(event)}' with contents:`,
      JSON.stringify(payload[0], null, 2)
    ].join('\n');

    throw new Error(errorMessage);
  }

  /**
   * Subscribe a callback to an event.
   */
  public on<T extends EventKeys<TEventMap>>(event: T, handler: SingleEventHandler<TEventMap, T>): Subscription {
    return this.addListener(event, handler);
  }

  public emit<T extends EventKeys<TEventMap>>(event: T, ...payload: EventPayload<TEventMap, T>): boolean {
    if(event === WILDCARD) {
      throw new Error(`Do not emit "${String(event)}" manually. Reserved for internal use.`);
    }

    let handled = false;

    handled = this.emitEvent(event, ...payload) || handled;
    handled = this.emitEvent(WILDCARD, event, ...payload) || handled;
    handled = this.forward<T>(event, ...payload) || handled;

    if(!handled && !this.options.allowUnhandledEvents) {
      this.handleUnexpectedEvent<T>(event, ...payload);
    }
    return handled;
  }

  /**
   * Handle multiple events with the same handler.
   * [[EventSink]] receives raised event as first argument, payload as second argument
   */
  public any<TEvents extends EventKeys<TEventMap>[]>(events: TEvents, handler: EventSink<TEventMap>): Subscription {
    return subscriptionWrapper(over(
      (events as any).map(<TEvent extends ElementType<TEvents>>(e: TEvent) => {
        const anyHandler = (payload: TEventMap[TEvent]) => handler(e, payload);
        return this.addListener(e, anyHandler);
      })
    ));
  }

  /**
   * Utility for resolving/rejecting a promise based on the reception of an event.
   * Promise will resolve with event payload, if a single event, or undefined if listening to multiple events.
   * @param resolutionTrigger - what event/events should resolve the promise
   * @param rejectionTrigger - what event/events should reject the promise. Must be mutually disjoint with `resolvingEvent`
   */
  public next<T extends Listenable<EventKeys<TEventMap>>>(
    resolutionTrigger: T,
    // this ensures the resolving and rejecting events are disjoint sets
    rejectionTrigger?: T extends WILDCARD
      ? never
      : T extends EventKeys<TEventMap>[]
        ? EventKeys<Omit<TEventMap, T[number]>>|EventKeys<Omit<TEventMap, T[number]>>[]
        : T extends EventKeys<TEventMap>
          ? EventKeys<Omit<TEventMap, T>>|EventKeys<Omit<TEventMap, T>>[]
          : never
  ): CancelablePromise<T extends EventKeys<TEventMap> ? TEventMap[T] : void> {
    let settled: boolean = false;
    let resolveInternalPromise: (value: T extends EventKeys<TEventMap> ? TEventMap[T] : void) => void;
    let rejectInternalPromise: (err?: Error) => void;
    let willDestroyListener: Subscription;

    const resolutionSub = subscribeListenable(this, resolutionTrigger, (_event, payload) => {
      if(resolutionTrigger === WILDCARD || Array.isArray(resolutionTrigger)) {
        resolve(undefined as T extends EventKeys<TEventMap> ? TEventMap[T] : void);
      } else {
        resolve(payload as T extends EventKeys<TEventMap> ? TEventMap[T] : void);
      }
    });
    const rejectionSub = rejectionTrigger
      ? subscribeListenable(this, rejectionTrigger, (event) => {
          reject(new Error(`Rejected with event (${String(event)})`));
        })
      : null;

    function resolve(payload: T extends EventKeys<TEventMap> ? TEventMap[T] : void): void {
      if(settle()) {
        resolveInternalPromise?.(payload);
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

    const p: CancelablePromise<T extends EventKeys<TEventMap> ? TEventMap[T] : void> = cancelable<T extends EventKeys<TEventMap> ? TEventMap[T] : void>(() => {
      return new Promise<T extends EventKeys<TEventMap> ? TEventMap[T] : void>(($resolve, $reject) => {
        resolveInternalPromise = $resolve;
        rejectInternalPromise = $reject;
      });
    });

    // handle cancelation
    p.catch((e: unknown): void => undefined).finally(settle);

    willDestroyListener = this.hook('willDestroy', () => p.cancel(`${this.name} destroyed`));

    return p;
  }

  private readonly scannerPools = new WeakMap<Scanner.Evaluator<any, TEventMap>, Map<'eager'|'lazy', {
    wildcard: Promise<any>|undefined;
    event: (Map<Promise<any>, Set<EventKeys<TEventMap>>>[]);
  }>>();
  private readonly scannerPoolConstituencies = new WeakMap<Promise<any>, {
    scanner: CancelablePromise<any>,
    constituentCount: number
  }>();

  /**
   * Utility for resolving/rejecting a promise based on an evaluation done when an event is triggered.
   * If params.eager=true (default), evaluates condition immedately.
   * If evaluator resolves or rejects in the eager evaluation, the scanner does not subscribe to any events
   * @param params
   * @param params.evaluator - an evaluation function that should check for a certain state
   * and may resolve or reject the scan based on the state.
   * @param params.trigger - event or events that should trigger evaluator
   * @param {boolean} [params.pool=true] - attempt to pool scanners that can be resolved by the same evaluator and trigger; default is `true`
   * @param {integer} [params.timeout] - cancel the scan after `params.timeout` milliseconds. Values `<= 0` are ignored.
   * Currently pooling timeouts is not supported. If `params.timeout` is configured, it will disable pooling regardless if `params.pool=true`
   * @param {boolean} [params.eager=true] - should `params.evaluator` be called immediately; default is `true`.
   * This eliminates the following anti-pattern:
   * ```
   * if(!someCondition) {
   *  await this.scan({evaluator: evaluateSomeCondition, trigger: ...});
   * }
   * ```
   */
  public scan<TEvaluator extends Scanner.Evaluator<any, TEventMap>>(
    params: {
      evaluator: TEvaluator;
      trigger: Listenable<EventKeys<TEventMap>>;
      eager?: boolean;
      pool?: boolean;
      timeout?: number;
  }): CancelablePromise<TEvaluator extends Scanner.Evaluator<infer U, TEventMap> ? U : any> {

    type TReturnType = TEvaluator extends Scanner.Evaluator<infer U, TEventMap> ? U : any;

    if(params.timeout && params.timeout > 0) {
      const scanner = new Scanner<TReturnType>(params);
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
      const scanner = new Scanner<TReturnType>(params);
      scanner.scan<TEventMap>(this, params.trigger);
      // tslint:disable-next-line:prefer-object-spread
      return Object.assign(
        scanner,
        {[INTERNAL_PROMISE]: scanner}
      );

    }

    /*
    Determine if we can use an existing scanner
    - are the evaluators the same?
    - is the eager flag the same?
    - is the trigger a subset of an existing trigger?
    */
    const lazyOrEager: 'eager'|'lazy' = (params.eager === false) ? 'lazy' : 'eager';

    const getExisting = (): Promise<TReturnType>|undefined => {
      const pools = this.scannerPools.get(params.evaluator)?.get(lazyOrEager);
      if(pools) {
        if(pools.wildcard) {
          return pools.wildcard;
        } else if(params.trigger !== WILDCARD) {
          const events: Set<EventKeys<TEventMap>> = new Set(Array.isArray(params.trigger) ? params.trigger : [params.trigger]);
          // start comparing with longest candidates first
          const candidatesByEventCountDesc = pools.event.slice(events.size - 1).reverse();
          for(const candidatesOfEventCountN of candidatesByEventCountDesc) {
            evaluateCandidate:
            for(const [_promise, _events] of candidatesOfEventCountN) {
              for(const e of events) {
                if(!_events.has(e as EventKeys<TEventMap>)) {
                  continue evaluateCandidate;
                }
              }
              return _promise;
            }
          }
        }
      }
    };
    const createNew = (): Promise<TReturnType> => {
      const scanner = new Scanner<TReturnType>(params);
      scanner.scan<TEventMap>(this, params.trigger);

      let byEvaluator = this.scannerPools.get(params.evaluator);
      if(!byEvaluator) {
        byEvaluator = new Map();
        this.scannerPools.set(params.evaluator, byEvaluator);
      }
      let pools = byEvaluator.get(lazyOrEager);
      if(!pools) {
        pools = {
          wildcard: undefined,
          event: []
        };
        byEvaluator.set(lazyOrEager, pools);
      }

      const _promise = new Promise<TReturnType>(
        async (resolve, reject) => {
          try {
            resolve(await scanner);
          } catch(e) {
            reject(e);
          } finally {
            this.scannerPoolConstituencies.delete(_promise);
            this.cleanupPooledScanner({
              ...params,
              lazyOrEager,
              promise: _promise
            });
          }
        }
      );

      this.scannerPoolConstituencies.set(_promise, {
        scanner,
        constituentCount: 0
      });

      if(params.trigger === WILDCARD) {
        pools.wildcard = _promise;
      } else {
        const events: Set<EventKeys<TEventMap>> = new Set(Array.isArray(params.trigger) ? params.trigger : [params.trigger]);
        const index = events.size - 1;
        let byEventCount = pools.event[index];
        if(!byEventCount) {
          byEventCount = new Map<Promise<any>, Set<EventKeys<TEventMap>>>();
          pools.event[index] = byEventCount;
        }
        byEventCount.set(_promise, events);
      }
      return _promise;
    };

    const promise = getExisting() || createNew();
    const c = cancelable(() => promise);
    const cancel = c.cancel.bind(c);
    this.scannerPoolConstituencies.get(promise).constituentCount++;

    // tslint:disable-next-line:prefer-object-spread
    return Object.assign(
      c,
      {
        [INTERNAL_PROMISE]: promise,
        cancel: (...args: any[]) => {
          if(cancel(...args)) {
            const entry = this.scannerPoolConstituencies.get(promise);
            if(entry?.constituentCount > 1) {
              entry.constituentCount--;
            } else if(entry) {
              entry.scanner.cancel();
            }
          }
        }
      }
    );
  }

  private cleanupPooledScanner(params: {
    evaluator: Scanner.Evaluator<any, any>;
    trigger: Listenable<EventKeys<TEventMap>>;
    lazyOrEager: 'eager'|'lazy';
    promise: Promise<any>;
  }): void {
    const byEvaluator = this.scannerPools.get(params.evaluator);
    if(byEvaluator) {
      const pools = byEvaluator.get(params.lazyOrEager);
      if(pools) {
        if(params.trigger === WILDCARD) {
          pools.wildcard = null;
          if(!pools.event || pools.event?.length === 0) {
            byEvaluator.delete(params.lazyOrEager);
            if(byEvaluator.size === 0) {
              this.scannerPools.delete(params.evaluator);
            }
          }
        } else {
          const byEvent = pools.event;
          if(byEvent) {
            const events: Set<EventKeys<TEventMap>> = new Set(Array.isArray(params.trigger) ? params.trigger : [params.trigger]);
            const index = events.size - 1;
            const byEventCount = byEvent[index];
            if(byEventCount) {
              byEventCount.delete(params.promise);
              if(byEventCount.size === 0 && byEvent.every(b => b.size === 0)) {
                if(!pools.wildcard) {
                  byEvaluator.delete(params.lazyOrEager);
                  if(byEvaluator.size === 0) {
                    this.scannerPools.delete(params.evaluator);
                  }
                } else {
                  pools.event = [];
                }
              }
            }
          }
        }
      }
    }
  }

  /**
   * Pipe events into another bus, or into a function sink.
   * Function sinks receive the raised event as the first argument and payload as the second.
   */
  public pipe(sink: EventSink<TEventMap>): Subscription;
  public pipe<TDelegate extends Bus<TEventMap>>(delegate: TDelegate): TDelegate & Bus<TEventMap>;
  public pipe(delegate: EventSink<TEventMap> | Bus<TEventMap>): Subscription | Bus<TEventMap> {
    if(typeof delegate === 'function') {
      const sink = delegate as EventSink<TEventMap>;
      this._eventSinks.set(sink, this.addListener(WILDCARD, sink));
      return subscriptionWrapper(() => this.unpipe(sink));
    } else {
      const bus = delegate as Bus<TEventMap>;
      if(bus !== this as any) {
        if(!this._delegates.has(bus)) {
          this._delegates.set(bus, [
            bus.hook(Lifecycle.willAddListener, this.willAddListener),
            bus.hook(Lifecycle.didAddListener, event => this.didAddListener(event, bus)),
            bus.hook(Lifecycle.willRemoveListener, this.willRemoveListener),
            bus.hook(Lifecycle.didRemoveListener, event => this.didRemoveListener(event, bus))
          ]);
        }
      }
      return bus;
    }
  }

  public unpipe<TDelegate extends (Bus<TEventMap>|EventSink<TEventMap>)>(delegate: TDelegate): void {
    if(typeof delegate === 'function') {
      this._eventSinks.get(delegate)?.();
      this._eventSinks.delete(delegate);
    } else {
      over(this._delegates.get(delegate) || [])();
      this._delegates.delete(delegate);
    }
  }

  /**
   * Subscribe to meta changes to the [[Bus]] with [[Lifecycle]] events
   */
  public hook<L extends Lifecycle>(event: L, handler: (payload: Lifecycle.EventMap<TEventMap>[L]) => void): Subscription {
    addListener(this.lifecycle, event, handler);
    return subscriptionWrapper(() => removeListener(this.lifecycle, event, handler));
  }

  /**
   * Subscribe to meta states of the [[Bus]], `idle` and `active`.
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
   * The active state of the bus, i.e. does it have any subscribers. Subscribers include delegates and scanners
   * @getter `boolean`
   */
  public get active(): boolean {
    return this._active;
  }

  /**
   * @getter `string`
   */
  public get name(): string {
    return `${this.options.name} ${this.constructor.name}`;
  }

  /**
   * @getter `boolean`
   */
  public get hasListeners(): boolean {
    return this.hasOwnListeners || this.hasDelegateListeners;
  }

  /**
   * @getter `boolean`
   */
  public get hasOwnListeners(): boolean {
    return this.bus.size > 0;
  }

  /**
   * @getter `boolean`
   */
  public get hasDelegateListeners(): boolean {
    return this._delegateListenerTotalCount > 0;
  }

  private _cachedGetListersValue: Map<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>>;
  public get listeners(): ReadonlyMap<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>> {
    if(!this._cachedGetListersValue) {
      const listenerCache = new Map(this.ownListeners);
      for(const delegate of this._delegates.keys()) {
        for(const [event, delegateListeners] of delegate.listeners) {
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
      }
      this._cachedGetListersValue = listenerCache;
    }
    return this._cachedGetListersValue;
  }

  private _cachedGetOwnListenersValue: Map<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>>;
  public get ownListeners(): ReadonlyMap<EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>> {
    if(!this._cachedGetOwnListenersValue) {
      const ownListenerCache = new Map<EventKeys<TEventMap>|WILDCARD, Set<GenericHandler>>();
      for(const [event, listeners] of this.bus) {
        if(listeners.size) {
          ownListenerCache.set(event, new Set(listeners));
        }
      }
      this._cachedGetOwnListenersValue = ownListenerCache;
    }
    return this._cachedGetOwnListenersValue;
  }

  public hasListenersFor(event: EventKeys<TEventMap>|WILDCARD): boolean {
    return this.getListenerCountFor(event) > 0;
  }

  public hasOwnListenersFor(event: EventKeys<TEventMap>|WILDCARD): boolean {
    return this.getOwnListenerCountFor(event) > 0;
  }

  public hasDelegateListenersFor(event: EventKeys<TEventMap>|WILDCARD): boolean {
    return this.getDelegateListenerCountFor(event) > 0;
  }

  public get listenerCount(): number {
    return this.bus.size + this._delegateListenerTotalCount;
  }

  public getListenerCountFor(event: EventKeys<TEventMap>|WILDCARD): number {
    return this.getOwnListenerCountFor(event) + this.getDelegateListenerCountFor(event);
  }

  public getOwnListenerCountFor(event: EventKeys<TEventMap>|WILDCARD): number {
    return this.bus.get(event)?.size ?? 0;
  }

  public getDelegateListenerCountFor(event: EventKeys<TEventMap>|WILDCARD): number {
    return (this._delegateListenerCountsByEvent.get(event) ?? 0);
  }

  /**
   * Remove all event subscribers, lifecycle subscribers, and delegates
   * triggers lifecycle meta events for all subscribed events before removing lifecycle subscribers
   * @emits [[Lifecycle.willDestroy]]
   * @event [[Lifecycle.willDestroy]]
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
    for(const subs of Object.values(this._delegates)) {
      for(const sub of subs()) {
        sub();
      }
    }
    this._delegates.clear();
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
      this._unsubQueue.push({
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

    while(this._unsubQueue.length) {
      const {token, event, handler} = this._unsubQueue.shift();
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

  private forward<T extends EventKeys<TEventMap>>(event: T, ...payload: EventPayload<TEventMap, T>): boolean {
    const {_delegates} = this;
    if(_delegates.size) {
      return Array.from(_delegates.keys())
        .reduce((acc, d) => (d.emit(event as any, ...payload) || acc), false);
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

    this._cachedGetListersValue = null;
    if(bus === this) {
      this._cachedGetOwnListenersValue = null;
    } else {
      const currCount = this._delegateListenerCountsByEvent.get(event) ?? 0;
      this._delegateListenerCountsByEvent.set(event, Math.max(currCount + 1, 0));
      this._delegateListenerTotalCount = Math.max(this._delegateListenerTotalCount + 1, 0);
    }

    this.emitLifecycleEvent(Lifecycle.didAddListener, event);
    if(!this._active && this.hasListeners) {
      this._active = true;
      this.emitLifecycleEvent(Lifecycle.active, null);
    }
  }


  private willRemoveListener(event: EventKeys<TEventMap>|WILDCARD): void {
    const eventHandlerCount = this.getListenerCountFor(event);
    if(eventHandlerCount) {
      this.emitLifecycleEvent(Lifecycle.willRemoveListener, event);
      if(this._active && this.listenerCount === 1 && eventHandlerCount === 1) {
        this.emitLifecycleEvent(Lifecycle.willIdle, null);
      }
    }
  }

  private didRemoveListener(event: EventKeys<TEventMap>|WILDCARD, bus: Bus<any> = this) {

    this._cachedGetListersValue = null;
    if(bus === this) {
      this._cachedGetOwnListenersValue = null;
    } else {
      const currCount = this._delegateListenerCountsByEvent.get(event) ?? 0;
      this._delegateListenerCountsByEvent.set(event, Math.max(currCount - 1, 0));
      this._delegateListenerTotalCount = Math.max(this._delegateListenerTotalCount - 1, 0);
    }

    this.emitLifecycleEvent(Lifecycle.didRemoveListener, event);
    if(this._active && !this.hasListeners) {
      this._active = false;
      this.emitLifecycleEvent(Lifecycle.idle, null);
    }
  }
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
