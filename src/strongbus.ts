import * as EventEmitter from 'eventemitter3';
import {autobind} from 'core-decorators';
import {forEach, uniq, compact, size, over, flatten} from 'lodash';

import {Logger} from './types/logger';
import {Lifecycle} from './types/lifecycle';
import {Options, ListenerThresholds} from './types/options';
import {StringKeys, ElementType} from './types/utility';
import * as Events from './types/events';
import * as EventHandlers from './types/eventHandlers';
import {randomId} from './utils/randomId';


@autobind
export class Bus<TEventMap extends object = object> {

  private static defaultOptions: Required<Options> = {
    name: 'Anonymous',
    allowUnhandledEvents: true,
    thresholds: {
      info: 100,
      warn: 500,
      error: Infinity
    },
    logger: console
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
   * Set the default logger for all instances to an object that implements [[Logger]] interface
   * @setter [[Logger]]
   */
  public static set defaultLogger(logger: Logger) {
    Bus.defaultOptions.logger = logger;
  }

  private _active = false;
  private _delegates = new Map<Bus<TEventMap>, Events.Subscription[]>();
  private readonly lifecycle: EventEmitter<Lifecycle> = new EventEmitter<Lifecycle>();
  private readonly bus: EventEmitter = new EventEmitter();
  private readonly subscriptionCache = new Map<string, Events.Subscription>();
  private readonly options: Required<Options>;

  constructor(options?: Options) {
    this.options = {
      ...Bus.defaultOptions,
      ...options || {} as any,
      thresholds: {
        ...(options || {} as any).thresholds,
        ...Bus.defaultOptions.thresholds
      }
    };
    this.decorateOnMethod();
    this.decorateEmitMethod();
    this.decorateRemoveListenerMethod();
  }

  /**
   * @override
   * How should the bus handle events emitted that have no listeners.
   * The default implementation is to throw an error.
   * Will be invoked when an instance's `options.allowUnhandledEvents = false` (default is true).
   */
  protected handleUnexpectedEvent<T extends StringKeys<TEventMap>>(event: T, payload: TEventMap[T]) {
    const errorMessage = [
      `TypedMsgBus received unexpected message type '${event}' with contents:`,
      JSON.stringify(payload, null, 2)
    ].join('\n');

    throw new Error(errorMessage);
  }

  /**
   * Subscribe a callback to event(s).
   * alias of [[Bus.proxy]] when invoked with [[WILDCARD]],
   * alias of [[Bus.any]] when invoked with an array of events
   */
  public on<T extends Events.Listenable<StringKeys<TEventMap>>>(event: T, handler: EventHandlers.EventHandler<TEventMap, T>): Events.Subscription {
    if(Array.isArray(event)) {
      return this.any(event, handler as EventHandlers.MultiEventHandler<TEventMap>);
    } else if(event === Events.WILDCARD) {
      return this.proxy(handler as EventHandlers.WildcardEventHandler<TEventMap>);
    } else {
      this.bus.on(event as StringKeys<TEventMap>, handler);
      return this.cacheListener(event as string, handler);
    }
  }

  public emit<T extends StringKeys<TEventMap>>(event: T, payload: TEventMap[T]): boolean {
    return this.bus.emit(event, payload);
  }

  /**
   * Handle multiple events with the same handler.
   * [[EventHandlers.MultiEventHandler]] receives raised event as first argument, payload as second argument
   */
  public any<TEvents extends StringKeys<TEventMap>[]>(events: TEvents, handler: EventHandlers.MultiEventHandler<TEventMap, TEvents>): Events.Subscription {
    return over(
      (events as any).map(<TEvent extends ElementType<TEvents>>(e: TEvent) => {
        const anyHandler = (payload: TEventMap[TEvent]) => handler(e, payload);
        this.bus.on(e, anyHandler);
        return this.cacheListener(e, anyHandler);
      })
    );
  }

  /**
   * Create a proxy for all events raised. Like [[Bus.any]], handlers receive the raised event as first
   * argument and payload as second argument.
   */
  public proxy(handler: EventHandlers.WildcardEventHandler<TEventMap>): Events.Subscription {
    this.bus.on(Events.WILDCARD, handler);
    return this.cacheListener(Events.WILDCARD, handler);
  }

  /**
   * @alias [[Bus.proxy]]
   */
  public every(handler: EventHandlers.WildcardEventHandler<TEventMap>): Events.Subscription {
    return this.proxy(handler);
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
  public hook(event: Lifecycle, handler: (targetEvent: StringKeys<TEventMap>) => void): Events.Subscription {
    this.lifecycle.on(event, handler);
    return () => this.lifecycle.removeListener(event, handler);
  }

  /**
   * Subscribe to meta states of the [[Bus]], `idle` and `active`.
   * Bus becomes idle when it goes from 1 to 0 subscribers, and active when it goes from 0 to 1.
   * The handler receives a `boolean` indicating if the bus is active (`true`) or idle (`false`)
   */
  public monitor(handler: (activeState: boolean) => void): Events.Subscription {
    return over([
      this.hook(Lifecycle.active, () => handler(true)),
      this.hook(Lifecycle.idle, () => handler(false))
    ]);
  }

  /**
   * The active state of the bus, i.e. does it have any subscribers.
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
    return Boolean(this.bus.eventNames().reduce((acc, event) => {
      return (acc || this.hasListenersFor(event.toString() as StringKeys<TEventMap>));
    }, false));
  }

  /**
   * @getter `boolean`
   */
  public get hasDelegateListeners(): boolean {
    return Array.from(this._delegates.keys())
      .reduce((acc, d) => (acc || d.hasListeners), false);
  }

  /**
   * @getter `{[eventName]: EventEmitter.ListenerFn[]}`
   */
  public get listeners(): {[event: string]: EventEmitter.ListenerFn[]} {
    const ownListeners = this.ownListeners;
    const delegates = Array.from(this._delegates.keys());
    const delegateListenersByEvent: {[event: string]: EventEmitter.ListenerFn[]} = delegates.reduce((acc, delegate) => {
      forEach(delegate.listeners, (listeners: EventEmitter.ListenerFn[], event: Events.Event) => {
        event = event.toString();
        if(acc[event]) {
          acc[event] = [
            ...acc[event],
            ...listeners
          ];
        } else {
          acc[event] = listeners;
        }
      });
      return acc;
    }, {} as {[event: string]: EventEmitter.ListenerFn[]});

    const allEvents = uniq([...Object.keys(ownListeners), ...Object.keys(delegateListenersByEvent)]);
    return allEvents.reduce((acc: {[event: string]: EventEmitter.ListenerFn[]}, event: string) => {
      const eventListeners = compact([
        ...(ownListeners[event] || []),
        ...(delegateListenersByEvent[event] || [])
      ]);
      if(eventListeners && eventListeners.length) {
        acc[event] = eventListeners;
      }
      return acc;
    }, {});
  }

  private get ownListeners(): {[event: string]: EventEmitter.ListenerFn[]} {
    return this.bus.eventNames().reduce((acc, event) => {
      return {
        ...acc,
        [event]: this.bus.listeners(event)
      };
    }, {});
  }

  public hasListenersFor<TEvents extends StringKeys<TEventMap>>(event: TEvents): boolean {
    return this.hasOwnListenersFor(event) || this.hasDelegateListenersFor(event);
  }

  public  hasOwnListenersFor<TEvents extends StringKeys<TEventMap>>(event: TEvents): boolean {
    return this.bus.listenerCount(event) > 0;
  }

  public hasDelegateListenersFor<TEvents extends StringKeys<TEventMap>>(event: TEvents): boolean {
    return Array.from(this._delegates.keys())
      .reduce((acc, d) => (d.hasListenersFor(event) || acc), false);
  }

  /**
   * Remove all event subscribers, lifecycle subscribers, and delegates
   * triggers lifecycle meta events for all subscribed events before removing lifecycle subscribers
   */
  public destroy() {
    this.releaseSubscribers();
    this.lifecycle.removeAllListeners();
    this.releaseDelegates();
  }

  private releaseSubscribers(): void {
    // any un-invoked unsubscribes will be invoked,
    // their lifecycle hooks will be triggered,
    // and they will be removed from the cache
    over(Array.from(this.subscriptionCache.values()))();
    this.bus.removeAllListeners();
  }

  private releaseDelegates(): void {
    const delegateSubs: Events.Subscription[] = flatten(Array.from(this._delegates.values()));
    over(delegateSubs)();
    this._delegates.clear();
  }

  private cacheListener(event: string, handler: EventEmitter.ListenerFn): Events.Subscription {
    const token = randomId();
    const sub = () => {
      if(this.subscriptionCache.has(token)) {
        this.bus.removeListener(event, handler);
        this.subscriptionCache.delete(token);
      }
    };
    this.subscriptionCache.set(token, sub);
    return sub;
  }

  private decorateOnMethod() {
    const on: EventEmitter['on'] = (...args) => EventEmitter.prototype.on.call(this.bus, ...args);

    this.bus.on = (event: StringKeys<TEventMap>, handler: EventEmitter.ListenerFn, context?: any): EventEmitter => {
      const {thresholds, logger} = this.options;
      const n: number = this.bus.listeners(event).length;
      if(n > thresholds.info) {
        logger.info(`${this.name} has ${n} listeners for "${event}", ${thresholds.info} max listeners expected.`);
      } else if(n > thresholds.warn) {
        logger.warn(`Potential Memory Leak. ${this.name} has ${n} listeners for "${event}", exceeds threshold set to ${thresholds.warn}`);
      } else if(n > thresholds.error) {
        logger.error(`Potential Memory Leak. ${this.name} has ${n} listeners for "${event}", exceeds threshold set to ${thresholds.error}`);
      }
      this.willAddListener(event);
      const emitter = on(event, handler, context);
      this.didAddListener(event);
      return emitter;
    };
  }

  private decorateEmitMethod() {

    const raise: EventEmitter['emit'] = (...args): boolean => EventEmitter.prototype.emit.call(this.bus, ...args);

    this.bus.emit = <T extends StringKeys<TEventMap>>(event: T, payload: TEventMap[T], ...args: any[]): boolean => {
      let handled = false;

      if(event === Events.WILDCARD) {
        throw new Error(`Do not emit "${event}" manually. Reserved for internal use.`);
      }

      handled = raise(event, payload) || handled;
      handled = raise(Events.WILDCARD, event, payload) || handled;
      handled = this.forward(event, payload) || handled;

      if(!handled && !this.options.allowUnhandledEvents) {
        this.handleUnexpectedEvent(event, payload);
      }
      return handled;
    };
  }

  private decorateRemoveListenerMethod() {
    const removeListener: EventEmitter['removeListener'] = (...args): EventEmitter => EventEmitter.prototype.removeListener.call(this.bus, ...args);

    this.bus.removeListener = (event: StringKeys<TEventMap>, handler: EventEmitter.ListenerFn, context?: any, once?: boolean): EventEmitter => {
      this.willRemoveListener(event);
      const emitter = removeListener(event, handler, context, once);
      this.didRemoveListener(event);
      return emitter;
    };
  }

  private forward<T extends StringKeys<TEventMap>>(event: T, payload: TEventMap[T], ...args: any[]): boolean {
    const {_delegates} = this;
    if(_delegates.size) {
      return Array.from(_delegates.keys())
        .reduce((acc, d) => (d.emit(event, payload) || acc), false);
    } else {
      return false;
    }
  }

  private willAddListener(event: StringKeys<TEventMap>) {
    this.lifecycle.emit(Lifecycle.willAddListener, event);
    if(!this.active) {
      this.lifecycle.emit(Lifecycle.willActivate);
    }
  }

  private didAddListener(event: StringKeys<TEventMap>) {
    this.lifecycle.emit(Lifecycle.didAddListener, event);
    if(!this.active && this.hasListeners) {
      this._active = true;
      this.lifecycle.emit(Lifecycle.active);
    }
  }

  private willRemoveListener(event: StringKeys<TEventMap>) {
    this.lifecycle.emit(Lifecycle.willRemoveListener, event);
    if(this.active && size(this.listeners) === 1) {
      this.lifecycle.emit(Lifecycle.willIdle);
    }
  }

  private didRemoveListener(event: StringKeys<TEventMap>) {
    this.lifecycle.emit(Lifecycle.didRemoveListener, event);
    if(this.active && !this.hasListeners) {
      this._active = false;
      this.lifecycle.emit(Lifecycle.idle);
    }
  }
}
