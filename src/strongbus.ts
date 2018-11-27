import * as EventEmitter from 'eventemitter3';
import {autobind} from 'core-decorators';
import strEnum from './utils/strEnum';
import {forEach, uniq, compact, size, over} from 'lodash';

export type EventSubscription = () => void;
export type Event = string|symbol;
export type Listenable<E extends Event> = E|E[]|'*';

export type Options = {
  allowUnhandledEvents?: boolean;
  maxListeners?: number;
  name?: string;
  potentialMemoryLeakWarningThreshold?: number;
};

export type EventHandler<TEvent, TEventMap extends object> =
  TEvent extends StringKeys<TEventMap>
    ? (payload: TEventMap[TEvent]) => void
    : () => void;

export type ProxyHandler<TEventMap extends object> =
  <T extends StringKeys<TEventMap>>(event: T, payload: TEventMap[T]) => void;

type StringKeys<T extends object> = Exclude<keyof T, number>;

export const Lifecycle = strEnum([
  'willActivate',
  'active',
  'willIdle',
  'idle',
  'willAddListener',
  'didAddListener',
  'willRemoveListener',
  'didRemoveListener'
]);
export type Lifecycle = keyof typeof Lifecycle;



const defaultOptions: Options = {
  allowUnhandledEvents: true,
  maxListeners: 50,
  potentialMemoryLeakWarningThreshold: 500
};

@autobind
export abstract class Bus<TEventMap extends object> {

  protected static reservedEvents = {
    EVERY: '*',
    PROXY: '@@PROXY@@'
  };

  private _active = false;
  private _delegates = new Map<Bus<TEventMap>, EventSubscription[]>();

  protected lifecycle: EventEmitter<Lifecycle> = new EventEmitter<Lifecycle>();
  protected bus: EventEmitter = new EventEmitter();
  protected config: Options;

  constructor(options?: Options) {
    this.configure(options);
    this.decorateOnMethod();
    this.decorateEmitMethod();
    this.decorateRemoveListenerMethod();
  }

  /**
   * @override
   * @param event
   * @param message
   */
  protected handleUnexpectedEvent<T extends StringKeys<TEventMap>>(event: T, payload: TEventMap[T]) {
    const errorMessage = [
      `TypedMsgBus received unexpected message type '${event}' with contents:`,
      JSON.stringify(payload, null, 2)
    ].join('\n');

    throw new Error(errorMessage);
  }

  public on<T extends Listenable<StringKeys<TEventMap>>>(
    event: T,
    handler: EventHandler<T, TEventMap>
  ): EventSubscription {
    if(Array.isArray(event)) {
      return this.any(event as StringKeys<TEventMap>[], () => (handler as any)());
    } else if(event === Bus.reservedEvents.EVERY) {
      const wrappedHandler = () => (handler as any)();
      this.bus.on(event as '*', wrappedHandler);
      return () => this.bus.removeListener(event as '*', wrappedHandler);
    } else {
      this.bus.on(event as string, handler);
      return () => this.bus.removeListener(event as string, handler);
    }
  }

  public emit<T extends StringKeys<TEventMap>>(
    event: T,
    payload: TEventMap[T]
  ): boolean {
    return this.bus.emit(event, payload);
  }

  /**
   * @description Handle multiple events with the same handler. Handler receives raised event as first argument, payload as second argument
   */
  public any<T extends StringKeys<TEventMap>>(events: T[], handler: ProxyHandler<TEventMap>): EventSubscription {
    return over(
      events.map((e: T) => {
        const anyHandler = (payload: TEventMap[T] ) => handler(e, payload);
        this.bus.on(e, anyHandler);
        return () => this.bus.removeListener(e, anyHandler);
      })
    );
  }

  /**
   * @description Handle ALL events raised with a single handler. Handler is invoked with no payload, and is unaware of the event that was emitted
   */
  public every(handler: () => void): EventSubscription {
    const {EVERY} = Bus.reservedEvents;
    this.bus.on(EVERY, handler);
    return () => this.bus.removeListener(EVERY, handler);
  }

  /**
   * Create a proxy for all events raised. Like `any`, handlers receive the raised event as first
   * argument and payload as second argument. Think of this as a combination of `any` and `every`
   */
  public proxy(handler: ProxyHandler<TEventMap>): EventSubscription {
    const {PROXY} = Bus.reservedEvents;
    this.bus.on(PROXY, handler);
    return () => this.bus.removeListener(PROXY, handler);
  }

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
    over(this._delegates.get(delegate))();
    this._delegates.delete(delegate);
  }

  public hook(event: Lifecycle, handler: EventEmitter.ListenerFn): EventSubscription {
    this.lifecycle.on(event, handler);
    return () => this.lifecycle.removeListener(event, handler);
  }

  public monitor(handler: (activeState: boolean) => void): EventSubscription {
    return over([
      this.hook(Lifecycle.active, () => handler(true)),
      this.hook(Lifecycle.idle, () => handler(false))
    ]);
  }

  public get active(): boolean {
    return this._active;
  }

  public get name(): string {
    return `${this.config.name} ${this.constructor.name}`;
  }

  public get hasListeners(): boolean {
    return this.hasOwnListeners || this.hasDelegateListeners;
  }

  public get hasOwnListeners(): boolean {
    return Boolean(this.bus.eventNames().reduce((acc, event) => {
      return (this.bus.listeners(event) || acc) as boolean;
    }, false));
  }

  public get hasDelegateListeners(): boolean {
    return Array.from(this._delegates.keys())
      .reduce((acc, d) => (d.hasListeners || acc), false);
  }

  public get listeners(): {[event: string]: EventEmitter.ListenerFn[]} {
    const ownListeners = this.ownListeners;
    const delegates = Array.from(this._delegates.keys());
    const delegateListenersByEvent: {[event: string]: EventEmitter.ListenerFn[]} = delegates.reduce((acc, delegate) => {
      forEach(delegate.listeners, (listeners: EventEmitter.ListenerFn[], event: Event) => {
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

  public destroy() {
    this.bus.removeAllListeners();
    this.lifecycle.removeAllListeners();
    this._delegates.clear();
  }

  private configure(options?: Options) {
    this.config = {
      ...defaultOptions,
      name: `Anonymous`,
      ...options
    };
  }

  private decorateOnMethod() {
    const on: EventEmitter['on'] = (...args) => EventEmitter.prototype.on.call(this.bus, ...args);

    this.bus.on = (event: StringKeys<TEventMap>, handler: EventEmitter.ListenerFn, context?: any): EventEmitter => {
      const {maxListeners, potentialMemoryLeakWarningThreshold} = this.config;
      const n: number = this.bus.listeners(event).length;
      if(n > maxListeners) {
        console.info(`${this.name} has ${n} listeners for "${event}", ${maxListeners} max listeners expected.`);
      } else if(n > potentialMemoryLeakWarningThreshold) {
        console.warn(`Potential Memory Leak. ${this.name} has ${n} listeners for "${event}", exceeds threshold set to ${potentialMemoryLeakWarningThreshold}`);
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
      const {EVERY, PROXY} = Bus.reservedEvents;

      if(event === EVERY || event === PROXY) {
        throw new Error(`Do not emit "${event}" manually. Reserved for internal use.`);
      }

      handled = raise(event, payload) || handled;
      handled = raise(EVERY, payload) || handled;
      handled = raise(PROXY, event, payload) || handled;
      handled = this.forward(event, payload) || handled;

      if(!handled && !this.config.allowUnhandledEvents) {
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
