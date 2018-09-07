import {autobind} from 'core-decorators';
import MsgBus, {EventSubscription, MsgBusOptions, MsgBusListenable} from '../msgBus';

export type TypedMsgBusEventHandler<TEvent, TMsgTypeMap extends object> =
  TEvent extends keyof TMsgTypeMap
    ? (msg: TMsgTypeMap[TEvent], ...args: any[]) => void
    : () => void;

export type TypedMsgBusProxyHandler<TMsgTypeMap extends object> =
  <T extends StringKeys<TMsgTypeMap>>(event: T, payload: TMsgTypeMap[T], ...args: any[]) => void;

type StringKeys<T extends object> = Exclude<keyof T, number>;

@autobind
export default class TypedMsgBus<MsgTypeMap extends object> extends MsgBus<(StringKeys<MsgTypeMap>)> {
  constructor(options?: MsgBusOptions) {
    super(options);
  }

  public on<T extends MsgBusListenable<Exclude<keyof MsgTypeMap, number>>>(
    event: T,
    handler: TypedMsgBusEventHandler<T, MsgTypeMap>
  ): EventSubscription {
    if(Array.isArray(event)) {
      return this.any(event as StringKeys<MsgTypeMap>[], () => (handler as any)());
    } else if(event === MsgBus.reservedEvents.EVERY) {
      const wrappedHandler = () => (handler as any)();
      this.bus.on(event as '*', wrappedHandler);
      return () => this.bus.removeListener(event as '*', wrappedHandler);
    } else {
      this.bus.on(event as string, handler);
      return () => this.bus.removeListener(event as string, handler);
    }
  }

  public emit<T extends Exclude<keyof MsgTypeMap, number>>(
    event: T,
    message: MsgTypeMap[T],
    ...args: any[]
  ): boolean {
    return this.bus.emit(event, message, ...args);
  }

  public proxy(handler: TypedMsgBusProxyHandler<MsgTypeMap>): EventSubscription {
    return super.proxy(handler);
  }

  protected handleUnexpectedEvent<T extends keyof MsgTypeMap>(event: T, message: MsgTypeMap[T]) {
    const errorMessage = [
      `TypedMsgBus received unexpected message type '${event}' with contents:`,
      JSON.stringify(message, null, 2)
    ].join('\n');

    throw new Error(errorMessage);
  }
}

