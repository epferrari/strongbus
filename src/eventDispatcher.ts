import {autobind} from 'core-decorators';

import type {SubscriptionManager} from './subscriptionManager';
import {WILDCARD, type EventMap} from './types/events';
import type {MaterializedBusOptions} from './types/materializedBusOptions';
import type {EventKeys} from './types/utility';

/**
 * Pipe graph callbacks supplied to {@link EventDispatcher}.
 * @internal
 */
export interface EventDispatcherHost<TEventMap extends EventMap> {
  propagate<T extends EventKeys<TEventMap>>(
    event: T,
    payload: TEventMap[T] | undefined,
    fromUpstream: boolean
  ): boolean;
}

/**
 * Dispatches raised events to local handlers and propagates along pipe edges.
 * @internal
 */
export namespace EventDispatcher {
  export type Params<TEventMap extends EventMap> = {
    subscriptions: Pick<SubscriptionManager<TEventMap>, 'consumeEvent'>;
    host: EventDispatcherHost<TEventMap>;
    options: Pick<MaterializedBusOptions, 'onUnhandledEvent'>;
  };
}

/**
 * @internal
 */
@autobind
export class EventDispatcher<TEventMap extends EventMap = EventMap> {

  private readonly subscriptions!: Pick<SubscriptionManager<TEventMap>, 'consumeEvent'>;
  private readonly host!: EventDispatcherHost<TEventMap>;
  private readonly options!: Pick<MaterializedBusOptions, 'onUnhandledEvent'>;

  constructor(params: EventDispatcher.Params<TEventMap>) {
    this.subscriptions = params.subscriptions;
    this.host = params.host;
    this.options = params.options;
  }

  public dispatchEvent<T extends EventKeys<TEventMap>>(
    event: T,
    payload: TEventMap[T],
    fromUpstream: boolean = false
  ): boolean {
    if((event as EventKeys<TEventMap> | WILDCARD) === WILDCARD) {
      throw new Error(`Do not emit "${String(event)}" manually. Reserved for internal use.`);
    }

    let handled = false;
    handled = this.subscriptions.consumeEvent(event, payload) || handled;
    handled = this.subscriptions.consumeEvent(WILDCARD as any, event, payload) || handled;
    handled = this.host.propagate(event, payload, fromUpstream) || handled;

    if(!handled) {
      if(this.options.onUnhandledEvent === 'throw') {
        this.throwOnUnhandledEvent(event, payload);
      } else if(typeof this.options.onUnhandledEvent === 'function') {
        this.options.onUnhandledEvent(event, payload);
      }
    }
    return handled;
  }

  private throwOnUnhandledEvent<T extends EventKeys<TEventMap>>(
    event: T,
    payload?: TEventMap[T]
  ) {
    const errorMessage = [
      `Strongbus.Bus received unexpected message type '${String(event)}' with contents:`,
      JSON.stringify(payload, null, 2)
    ].join('\n');

    throw new Error(errorMessage);
  }
}
