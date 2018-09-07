import {default as IEventEmitter, EventEmitter, ListenerFn} from 'eventemitter3';
import {autobind} from 'core-decorators';
import strEnum from '../utils/strEnum';
import {forEach, uniq, compact, size, over} from 'lodash';

export type EventSubscription = () => void;
export type Event = string|symbol;

export type MsgBusOptions = {
  allowUnhandledEvents?: boolean;
  maxListeners?: number;
  name?: string;
  potentialMemoryLeakWarningThreshold?: number;
};

export const MsgBusLifecycle = strEnum([
  'willActivate',
  'active',
  'willIdle',
  'idle',
  'willAddListener',
  'didAddListener',
  'willRemoveListener',
  'didRemoveListener'
]);
export type MsgBusLifecycle = keyof typeof MsgBusLifecycle;

export type MsgBusListenable<E extends Event> = E|E[]|'*';

const defaultOptions: MsgBusOptions = {
  allowUnhandledEvents: true,
  maxListeners: 50,
  potentialMemoryLeakWarningThreshold: 500
};

type InternalEvents<TEvent extends Event> = TEvent|'*'|'@@PROXY@@';

@autobind
export default abstract class MsgBus<TEvent extends Event> {

  protected static reservedEvents = {
    EVERY: '*',
    PROXY: '@@PROXY@@'
  };

  private _active = false;
  private _delegates = new Map<MsgBus<Event>, EventSubscription[]>();

  protected lifecycle: IEventEmitter<MsgBusLifecycle> = new EventEmitter<MsgBusLifecycle>();
  protected bus: IEventEmitter = new EventEmitter();
  protected config: MsgBusOptions;

  public abstract on(event: MsgBusListenable<TEvent>, handler: Function): EventSubscription;
  public abstract emit(event: TEvent, ...args: any[]): boolean;
  protected abstract handleUnexpectedEvent(event: TEvent, ...args: any[]): void;

  constructor(options?: MsgBusOptions) {
    this.configure(options);
    this.decorateOnMethod();
    this.decorateEmitMethod();
    this.decorateRemoveListenerMethod();
  }

  /**
   * Handle multiple events with the same handler. Handler receives event as first argument,
   * payload(s) as subsequent arguments
   */
  public any(events: TEvent[], handler: (event: TEvent, ...args: any[]) => void): EventSubscription {
    return over(
      events.map(e => {
        const _handler = (...payload) => handler(e, ...payload);
        this.bus.on(e, _handler);
        return () => this.bus.removeListener(e, _handler);
      })
    );
  }

  /**
   * Handle ALL events raised with a single handler. Handler is invoked with payload(s) emitted,
   * but is unaware of the event that was emitted
   */
  public every(handler: (...args: any[]) => void): EventSubscription {
    const {EVERY} = MsgBus.reservedEvents;
    this.bus.on(EVERY, handler);
    return () => this.bus.removeListener(EVERY, handler);
  }

  /**
   * Create a proxy for all events raised. Like `any`, handlers receive the event name as first
   * argument. Think of this as a combination of `any` and `every`
   */
  public proxy(handler: (event: TEvent, ...args: any[]) => void): EventSubscription {
    const {PROXY} = MsgBus.reservedEvents;
    this.bus.on(PROXY, handler);
    return () => this.bus.removeListener(PROXY, handler);
  }

  public pipe<B extends MsgBus<Event>>(delegate: B): B {
    if(delegate !== this as any) {
      if(!this._delegates.has(delegate)) {
        this._delegates.set(delegate, [
          delegate.hook(MsgBusLifecycle.willAddListener, this.willAddListener),
          delegate.hook(MsgBusLifecycle.didAddListener, this.didAddListener),
          delegate.hook(MsgBusLifecycle.willRemoveListener, this.willRemoveListener),
          delegate.hook(MsgBusLifecycle.didRemoveListener, this.didRemoveListener)
        ]);
      }
    }
    return delegate;
  }

  public unpipe<B extends MsgBus<Event>>(delegate: B): void {
    over(this._delegates.get(delegate))();
    this._delegates.delete(delegate);
  }

  public hook(event: MsgBusLifecycle, handler: ListenerFn): EventSubscription {
    this.lifecycle.on(event, handler);
    return () => this.lifecycle.removeListener(event, handler);
  }

  public monitor(handler: (activeState: boolean) => void): EventSubscription {
    return over([
      this.hook(MsgBusLifecycle.active, () => handler(true)),
      this.hook(MsgBusLifecycle.idle, () => handler(false))
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

  public get listeners(): {[event: string]: ListenerFn[]} {
    const ownListeners = this.ownListeners;
    const delegates = Array.from(this._delegates.keys());
    const delegateListenersByEvent: {[event: string]: ListenerFn[]} = delegates.reduce((acc, delegate) => {
      forEach(delegate.listeners, (listeners: ListenerFn[], event: Event) => {
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
    }, {} as {[event: string]: ListenerFn[]});

    const allEvents = uniq([...Object.keys(ownListeners), ...Object.keys(delegateListenersByEvent)]);
    return allEvents.reduce((acc, event) => {
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

  private get ownListeners(): {[event: string]: ListenerFn[]} {
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

  private configure(options?: MsgBusOptions) {
    this.config = Object.assign(
      {},
      defaultOptions,
      {name: `Anonymous`},
      options
    );
  }

  private decorateOnMethod() {
    const on: IEventEmitter['on'] = (...args) => EventEmitter.prototype.on.call(this.bus, ...args);

    this.bus.on = (event: TEvent, handler: ListenerFn, context?: any): IEventEmitter => {
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

    const raise: IEventEmitter['emit'] = (...args): boolean => EventEmitter.prototype.emit.call(this.bus, ...args);

    this.bus.emit = (event: TEvent, ...args: any[]): boolean => {
      let handled = false;
      const {forward} = this;
      const {EVERY, PROXY} = MsgBus.reservedEvents;

      if(event === EVERY || event === PROXY) {
        throw new Error(`Do not emit "${event}" manually. Reserved for internal use.`);
      }

      handled = raise(event, ...args) || handled;
      handled = raise(EVERY, ...args) || handled;
      handled = raise(PROXY, event, ...args) || handled;
      handled = forward(event, ...args) || handled;

      if(!handled && !this.config.allowUnhandledEvents) {
        this.handleUnexpectedEvent(event, ...args);
      }
      return handled;
    };
  }

  private decorateRemoveListenerMethod() {
    const removeListener: IEventEmitter['removeListener'] = (...args): IEventEmitter => EventEmitter.prototype.removeListener.call(this.bus, ...args);

    this.bus.removeListener = (event: TEvent, handler: ListenerFn, context?: any, once?: boolean): IEventEmitter => {
      this.willRemoveListener(event);
      const emitter = removeListener(event, handler, context, once);
      this.didRemoveListener(event);
      return emitter;
    };
  }

  private forward(event: TEvent, ...args: any[]): boolean {
    const {_delegates} = this;
    if(_delegates.size) {
      return Array.from(_delegates.keys())
        .reduce((acc, d) => (d.emit(event, ...args) || acc), false);
    } else {
      return false;
    }
  }

  private willAddListener(event: TEvent) {
    this.lifecycle.emit(MsgBusLifecycle.willAddListener, event);
    if(!this.active) {
      this.lifecycle.emit(MsgBusLifecycle.willActivate);
    }
  }

  private didAddListener(event: TEvent) {
    this.lifecycle.emit(MsgBusLifecycle.didAddListener, event);
    if(!this.active && this.hasListeners) {
      this._active = true;
      this.lifecycle.emit(MsgBusLifecycle.active);
    }
  }

  private willRemoveListener(event: TEvent) {
    this.lifecycle.emit(MsgBusLifecycle.willRemoveListener, event);
    if(this.active && size(this.listeners) === 1) {
      this.lifecycle.emit(MsgBusLifecycle.willIdle);
    }
  }

  private didRemoveListener(event: TEvent) {
    this.lifecycle.emit(MsgBusLifecycle.didRemoveListener, event);
    if(this.active && !this.hasListeners) {
      this._active = false;
      this.lifecycle.emit(MsgBusLifecycle.idle);
    }
  }
}
