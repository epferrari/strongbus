import MsgBus, {EventSubscription, MsgBusOptions, MsgBusListenable} from '../msgBus';
import {isNumber, debounce} from 'lodash';
import {autobind} from 'core-decorators';

type DebounceOptions = {
  leading?: boolean;
  trailing?: boolean;
  maxWait?: number;
  wait?: number;
};

export type SemiTypedMsgBusEventHandler<TEvent, TEvents> = TEvent extends '*'
  ? () => void
    : TEvent extends TEvents
      ? (...args: any[]) => void
      : () => void;

export type SemiTypedMsgBusListenable<E extends string|symbol> = MsgBusListenable<E>;

@autobind
export default class SemiTypedMsgBus<E extends string|symbol> extends MsgBus<E> {

  constructor(options?: MsgBusOptions) {
    super(options);
  }

  public on<T extends MsgBusListenable<E>>(
    event: T,
    handler: SemiTypedMsgBusEventHandler<T, E>,
    debounceOptions: DebounceOptions = {}
  ): EventSubscription {
    if(isNumber(debounceOptions.wait)) {
      handler = debounce(handler, debounceOptions.wait, debounceOptions);
    }

    if(Array.isArray(event)) {
      return this.any(event as E[], () => (handler as any)());
    } else if(event === MsgBus.reservedEvents.EVERY) {
      const wrappedHandler = () => (handler as any)();
      this.bus.on(event as '*', wrappedHandler);
      return () => this.bus.removeListener(event as '*', wrappedHandler);
    } else {
      this.bus.on(event as string, handler);
      return () => this.bus.removeListener(event as string, handler);
    }
  }

  public emit(event: E, ...args: any[]): boolean {
    return this.bus.emit(event, ...args);
  }

  protected handleUnexpectedEvent(event: E, ...args: any[]): void {
    throw new Error(`Unexpected Event ${event} with arguments ${args}`);
  }
}
