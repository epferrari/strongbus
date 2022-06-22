
import {autobind} from 'core-decorators';
import {CancelablePromise, cancelable} from 'jaasync';

import {Scanner} from './scanner';
import {StrongbusLogger} from './strongbusLogger';
import * as Events from './types/events';
import * as EventHandlers from './types/eventHandlers';
import {Lifecycle} from './types/lifecycle';
import {Logger} from './types/logger';
import {Options, ListenerThresholds} from './types/options';
import {Scannable} from './types/scannable';
import {EventKeys, ElementType} from './types/utility';
import {over} from './utils/over';
import {generateSubscription} from './utils/generateSubscription';
import {randomId} from './utils/randomId';
import {INTERNAL_PROMISE} from './utils/internalPromiseSymbol';


/**
 * @typeParam TEventMap - `{[Event]: Payload}`
 */
@autobind
export class Bus<TEventMap extends object = object> implements Scannable<TEventMap> {

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
  private _delegates = new Map<Bus<TEventMap>, Events.Subscription[]>();
  private readonly subscriptionCache = new Map<string, Events.Subscription>();
  private readonly options: Required<Options> & {thresholds: Required<ListenerThresholds>};

  private readonly bus = new Map<EventKeys<TEventMap>|Events.WILDCARD, Set<EventHandlers.GenericHandler>>();
  private readonly lifecycle = new Map<Lifecycle, Set<EventHandlers.GenericHandler>>();

  private readonly logger: StrongbusLogger<TEventMap>;

  // queue of unsubscription requests so that they are processed transactionally in order
  private readonly _unsubQueue: {
    token: string;
    event: EventKeys<TEventMap>|Events.WILDCARD;
    handler: EventHandlers.GenericHandler;
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
      impl: this.options.logger,
      name: this.name
    });
  }

  /**
   * @override
   * How should the bus handle events emitted that have no listeners.
   * The default implementation is to throw an error.
   * Will be invoked when an instance's `options.allowUnhandledEvents = false` (default is true).
   */
  protected handleUnexpectedEvent<T extends EventKeys<TEventMap>>(event: T, payload: TEventMap[T]) {
    const errorMessage = [
      `Strongbus.Bus received unexpected message type '${String(event)}' with contents:`,
      JSON.stringify(payload, null, 2)
    ].join('\n');

    throw new Error(errorMessage);
  }

  /**
   * Subscribe a callback to event(s).
   * alias of [[Bus.proxy]] when invoked with [[WILDCARD]],
   * alias of [[Bus.any]] when invoked with an array of events
   */
  public on<T extends Events.Listenable<EventKeys<TEventMap>>>(event: T, handler: EventHandlers.EventHandler<TEventMap, T>): Events.Subscription {
    if(Array.isArray(event)) {
      return this.any(event as (EventKeys<TEventMap>)[], handler as EventHandlers.MultiEventHandler<TEventMap>);
    } else if(event === Events.WILDCARD) {
      return this.proxy(handler as EventHandlers.WildcardEventHandler<TEventMap>);
    } else {
      return this.addListener(event as EventKeys<TEventMap>, handler);
    }
  }

  public emit<T extends EventKeys<TEventMap>>(event: T, payload: TEventMap[T]): boolean {
    if(event === Events.WILDCARD) {
      throw new Error(`Do not emit "${String(event)}" manually. Reserved for internal use.`);
    }

    let handled = false;

    handled = this.emitEvent(event, payload) || handled;
    handled = this.emitEvent(Events.WILDCARD, event, payload) || handled;
    handled = this.forward(event, payload) || handled;

    if(!handled && !this.options.allowUnhandledEvents) {
      this.handleUnexpectedEvent(event, payload);
    }
    return handled;
  }

  /**
   * Handle multiple events with the same handler.
   * [[EventHandlers.MultiEventHandler]] receives raised event as first argument, payload as second argument
   */
  public any<TEvents extends EventKeys<TEventMap>[]>(events: TEvents, handler: EventHandlers.MultiEventHandler<TEventMap, TEvents>): Events.Subscription {
    return generateSubscription(over(
      (events as any).map(<TEvent extends ElementType<TEvents>>(e: TEvent) => {
        const anyHandler = (payload: TEventMap[TEvent]) => handler(e, payload);
        return this.addListener(e, anyHandler);
      })
    ));
  }

  /**
   * Create a proxy for all events raised. Like [[Bus.any]], handlers receive the raised event as first argument and payload as second argument.
   */
  public proxy(handler: EventHandlers.WildcardEventHandler<TEventMap>): Events.Subscription {
    return this.addListener(Events.WILDCARD, handler);
  }

  /**
   * @alias [[Bus.proxy]]
   */
  public every(handler: EventHandlers.WildcardEventHandler<TEventMap>): Events.Subscription {
    return this.proxy(handler);
  }

  /**
   * Utility for resolving/rejecting a promise based on the reception of an event.
   * Promise will resolve with event payload, if a single event, or undefined if listening to multiple events.
   * @param resolutionTrigger - what event/events should resolve the promise
   * @param rejectionTrigger - what event/events should reject the promise. Must be mutually disjoint with `resolvingEvent`
   */
  public next<T extends Events.Listenable<EventKeys<TEventMap>>>(
    resolutionTrigger: T,
    // this ensures the resolving and rejecting events are disjoint sets
    rejectionTrigger?: T extends Events.WILDCARD
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
    let willDestroyListener: Events.Subscription;

    const resolutionSub = this.on(resolutionTrigger, ((...args: any[]) => {
      if(resolutionTrigger === Events.WILDCARD || Array.isArray(resolutionTrigger)) {
        resolve(undefined);
      } else {
        resolve(args[0]);
      }
    }) as any);
    const rejectionSub = rejectionTrigger
      ? this.on(rejectionTrigger, ((...args: any[]) => {
          let e: EventKeys<TEventMap>;
          if(rejectionTrigger === Events.WILDCARD || Array.isArray(rejectionTrigger)) {
            e = args[0];
          } else {
            e = rejectionTrigger as EventKeys<TEventMap>;
          }
          reject(new Error(`Rejected with event (${String(e)})`));
        }) as any)
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
    p.catch(e => null).finally(settle);

    willDestroyListener = this.hook('willDestroy', () => p.cancel(`${this.name} destroyed`));

    return p;
  }

  private readonly scannerPools = new WeakMap<Scanner.Evaluator<any, TEventMap>, Map<'eager'|'lazy', {
    wildcard: Promise<any>;
    event: (Map<Promise<any>, Set<EventKeys<TEventMap>>>[]);
  }>>();

  /**
   * Utility for resolving/rejecting a promise based on an evaluation done when an event is triggered.
   * If params.eager=true (default), evaluates condition immedately.
   * If evaluator resolves or rejects, the scanner does not subscribe to any events
   */
  public scan<TEvaluator extends Scanner.Evaluator<any, TEventMap>>(
    params: {
      evaluator: TEvaluator;
      trigger: Events.Listenable<EventKeys<TEventMap>>;
      eager?: boolean;
      pool?: boolean;
    }): CancelablePromise<TEvaluator extends Scanner.Evaluator<infer U, TEventMap> ? U : any> {

    type TReturnType = TEvaluator extends Scanner.Evaluator<infer U, TEventMap> ? U : any;

    if(params.pool === false) {
      const scanner = new Scanner<TReturnType>(params);
      scanner.scan<TEventMap>(this, params.trigger);
      return Object.assign(
        cancelable(() => scanner),
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
    let promise: Promise<TReturnType> = (() => {
      const pools = this.scannerPools.get(params.evaluator)?.get(lazyOrEager);
      if(pools) {
        if(pools.wildcard) {
          return pools.wildcard;
        } else if(params.trigger !== Events.WILDCARD) {
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
    })();

    if(!promise) {
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
          wildcard: null,
          event: []
        };
        byEvaluator.set(lazyOrEager, pools);
      }

      promise = new Promise<TReturnType>(
        async (resolve, reject) => {
          try {
            resolve(await scanner);
          } catch(e) {
            reject(e);
          } finally {
            this.cleanupPooledScanner({
              ...params,
              lazyOrEager,
              promise
            });
          }
        }
      );

      if(params.trigger === Events.WILDCARD) {
        pools.wildcard = promise;
      } else {
        const events: Set<EventKeys<TEventMap>> = new Set(Array.isArray(params.trigger) ? params.trigger : [params.trigger]);
        const index = events.size - 1;
        let byEventCount = pools.event[index];
        if(!byEventCount) {
          byEventCount = new Map<Promise<any>, Set<EventKeys<TEventMap>>>();
          pools.event[index] = byEventCount;
        }
        byEventCount.set(promise, events);
      }
    }

    return Object.assign(
      cancelable(() => promise),
      {[INTERNAL_PROMISE]: promise}
    );
  }

  private cleanupPooledScanner(params: {
    evaluator: Scanner.Evaluator<any, any>;
    trigger: Events.Listenable<EventKeys<TEventMap>>;
    lazyOrEager: 'eager'|'lazy';
    promise: Promise<any>;
  }): void {
    const byEvaluator = this.scannerPools.get(params.evaluator);
    if(byEvaluator) {
      const pools = byEvaluator.get(params.lazyOrEager);
      if(pools) {
        if(params.trigger === Events.WILDCARD) {
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
   * Pipe one bus's events into another bus's subscribers
   */
  public pipe<TDelegate extends Bus<TEventMap>>(delegate: TDelegate): TDelegate {
    if(delegate !== this as any) {
      if(!this._delegates.has(delegate)) {
        this._delegates.set(delegate, [
          delegate.hook(Lifecycle.willAddListener, this.willAddListener),
          delegate.hook(Lifecycle.didAddListener, this.didAddListener),
          delegate.hook(Lifecycle.willRemoveListener, this.willRemoveListener),
          delegate.hook(Lifecycle.didRemoveListener, this.didRemoveListener)
        ]);
      }
    }
    return delegate;
  }

  public unpipe<TDelegate extends Bus<TEventMap>>(delegate: TDelegate): void {
    over(this._delegates.get(delegate) || [])();
    this._delegates.delete(delegate);
  }

  /**
   * Subscribe to meta changes to the [[Bus]] with [[Lifecycle]] events
   */
  public hook<L extends Lifecycle>(event: L, handler: (payload: Lifecycle.EventMap<TEventMap>[L]) => void): Events.Subscription {
    addListener(this.lifecycle, event, handler);
    return generateSubscription(() => removeListener(this.lifecycle, event, handler));
  }

  /**
   * Subscribe to meta states of the [[Bus]], `idle` and `active`.
   * Bus becomes idle when it goes from 1 to 0 subscribers, and active when it goes from 0 to 1.
   * The handler receives a `boolean` indicating if the bus is active (`true`) or idle (`false`)
   */
  public monitor(handler: (activeState: boolean) => void): Events.Subscription {
    return generateSubscription(over([
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
    for(const delegate of this._delegates.keys()) {
      if(delegate.hasListeners) {
        return true;
      }
    }
    return false;
  }

  public get listeners(): Map<EventKeys<TEventMap>|Events.WILDCARD, Set<EventHandlers.GenericHandler>> {
    const map = this.ownListeners;
    this._delegates.forEach((_, delegate) => {
      delegate.listeners.forEach((delegateListeners, event) => {
        if(!delegateListeners.size) {
          return;
        }
        let listeners = map.get(event);
        if(!listeners) {
          listeners = new Set<EventHandlers.GenericHandler>();
          map.set(event, listeners);
        }
        delegateListeners.forEach(d => listeners.add(d));
      });
    });
    return map;
  }

  private get ownListeners(): Map<EventKeys<TEventMap>|Events.WILDCARD, Set<EventHandlers.EventHandler<TEventMap, any>>> {
    const map = new Map<EventKeys<TEventMap>|Events.WILDCARD, Set<EventHandlers.EventHandler<TEventMap, any>>>();
    this.bus.forEach((listeners, event) => {
      if(listeners.size) {
        map.set(event, new Set(listeners));
      }
    });
    return map;
  }

  public hasListenersFor(event: EventKeys<TEventMap>|Events.WILDCARD): boolean {
    return this.hasOwnListenersFor(event) || this.hasDelegateListenersFor(event);
  }

  public  hasOwnListenersFor(event: EventKeys<TEventMap>|Events.WILDCARD): boolean {
    const handlers = this.bus.get(event);
    return handlers?.size > 0;
  }

  public hasDelegateListenersFor(event: EventKeys<TEventMap>|Events.WILDCARD): boolean {
    for(const delegate of this._delegates.keys()) {
      if(delegate.hasListenersFor(event)) {
        return true;
      }
    }
    return false;
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
    this._delegates.forEach(subs => over(subs)());
    this._delegates.clear();
  }

  private addListener(event: EventKeys<TEventMap>|Events.WILDCARD, handler: EventHandlers.GenericHandler): Events.Subscription {
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
    return this.cacheListener(event as EventKeys<TEventMap>, handler);
  }

  private cacheListener(event: EventKeys<TEventMap>|Events.WILDCARD, handler: EventHandlers.GenericHandler): Events.Subscription {
    const token = randomId();
    const sub = generateSubscription(() => {
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

  private removeListener(event: EventKeys<TEventMap>|Events.WILDCARD, handler: EventHandlers.GenericHandler): void {
    this.willRemoveListener(event);
    const {removed} = removeListener(this.bus, event, handler);
    if(removed) {
      this.didRemoveListener(event);
      const count = this.bus.get(event)?.size ?? 0;
      this.logger.onListenerRemoved(event, count);
    }
  }

  private emitEvent(event: EventKeys<TEventMap>|Events.WILDCARD, ...args: any[]): boolean {
    const handlers = this.bus.get(event);
      if(handlers && handlers.size) {
        handlers.forEach(async fn => {
          try {
            await fn(...args);
          } catch(e) {
            this.emitLifecycleEvent(Lifecycle.error, {error: e, event});
          }
        });
        return true;
      }
      return false;
  }

  private emitLifecycleEvent<L extends Lifecycle>(event: L, payload: Lifecycle.EventMap<TEventMap>[L]): void {
    const handlers = this.lifecycle.get(event);
    if(handlers && handlers.size) {
      handlers.forEach(async fn => {
        try {
          await fn(payload);
        } catch(e) {
          if(event === Lifecycle.error) {
            const errorPayload = payload as Lifecycle.EventMap<TEventMap>['error'];
            this.options.logger.error('Error thrown in error handler', {
                errorHandler: fn.name,
                errorHandlerError: e,
                originalEvent: errorPayload.event,
                eventHandlerError: errorPayload.error
            });
          } else {
            this.emitLifecycleEvent(Lifecycle.error, {error: e, event});
          }
        }
      });
    }
  }

  private forward<T extends EventKeys<TEventMap>>(event: T, payload: TEventMap[T], ...args: any[]): boolean {
    const {_delegates} = this;
    if(_delegates.size) {
      return Array.from(_delegates.keys())
        .reduce((acc, d) => (d.emit(event, payload) || acc), false);
    } else {
      return false;
    }
  }

  private willAddListener(event: EventKeys<TEventMap>|Events.WILDCARD) {
    this.emitLifecycleEvent(Lifecycle.willAddListener, event);
    if(!this.active) {
      this.emitLifecycleEvent(Lifecycle.willActivate, null);
    }
  }

  private didAddListener(event: EventKeys<TEventMap>|Events.WILDCARD) {
    this.emitLifecycleEvent(Lifecycle.didAddListener, event);
    if(!this.active && this.hasListeners) {
      this._active = true;
      this.emitLifecycleEvent(Lifecycle.active, null);
    }
  }

  private willRemoveListener(event: EventKeys<TEventMap>|Events.WILDCARD): void {
    const eventHandlerCount = this.listeners.get(event)?.size || 0;
    if(eventHandlerCount) {
      this.emitLifecycleEvent(Lifecycle.willRemoveListener, event);
      if(this.active && this.listeners.size === 1 && eventHandlerCount === 1) {
        this.emitLifecycleEvent(Lifecycle.willIdle, null);
      }
    }
  }

  private didRemoveListener(event: EventKeys<TEventMap>|Events.WILDCARD) {
    this.emitLifecycleEvent(Lifecycle.didRemoveListener, event);
    if(this.active && !this.hasListeners) {
      this._active = false;
      this.emitLifecycleEvent(Lifecycle.idle, null);
    }
  }
}


/**
 * @ignore
 */
function addListener<TKey>(bus: Map<TKey, Set<EventHandlers.GenericHandler>>, event: TKey, handler: EventHandlers.GenericHandler): {added: boolean, first: boolean} {
  if(!handler) {
    return {added: false, first: false};
  }

  const prevSet = bus.get(event);
  const newSet = new Set<EventHandlers.GenericHandler>(prevSet);
  const first: boolean = Boolean(prevSet);
  newSet.add(handler);
  bus.set(event, newSet);
  return {added: true, first};
}

/**
 * @ignore
 */
function removeListener<TKey>(bus: Map<TKey, Set<EventHandlers.GenericHandler>>, event: TKey, handler: EventHandlers.GenericHandler): {removed: boolean, last: boolean} {
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
