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

  /** What {@link EventDispatcher.dispatchEvent} does with an event nothing handles, for a bus that has built no dispatcher. */
  public static dispatchUnhandled<TEventMap extends EventMap, T extends EventKeys<TEventMap>>(
    event: T,
    payload: TEventMap[T],
    options: Pick<MaterializedBusOptions, 'onUnhandledEvent'>
  ): false {
    EventDispatcher.assertNotReserved(event);
    EventDispatcher.reportUnhandled(event, payload, options);
    return false;
  }

  private static assertNotReserved(event: PropertyKey): void {
    if((event as PropertyKey | WILDCARD) === WILDCARD) {
      throw new Error(`Do not emit "${String(event)}" manually. Reserved for internal use.`);
    }
  }

  private static reportUnhandled<TEventMap extends EventMap, T extends EventKeys<TEventMap>>(
    event: T,
    payload: TEventMap[T],
    options: Pick<MaterializedBusOptions, 'onUnhandledEvent'>
  ): void {
    if(options.onUnhandledEvent === 'throw') {
      const errorMessage = [
        `Strongbus.Bus received unexpected message type '${String(event)}' with contents:`,
        JSON.stringify(payload, null, 2)
      ].join('\n');

      throw new Error(errorMessage);
    } else if(typeof options.onUnhandledEvent === 'function') {
      options.onUnhandledEvent(event, payload);
    }
  }

  public dispatchEvent<T extends EventKeys<TEventMap>>(
    event: T,
    payload: TEventMap[T],
    fromUpstream: boolean = false
  ): boolean {
    EventDispatcher.assertNotReserved(event);

    let handled = false;
    handled = this.subscriptions.consumeEvent(event, payload) || handled;
    handled = this.subscriptions.consumeEvent(WILDCARD as any, event, payload) || handled;
    handled = this.host.propagate(event, payload, fromUpstream) || handled;

    if(!handled) {
      EventDispatcher.reportUnhandled(event, payload, this.options);
    }
    return handled;
  }
}
