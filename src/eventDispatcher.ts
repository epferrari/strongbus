import {autobind} from 'core-decorators';
import { EventMap, WILDCARD } from './types/events';
import { EventKeys } from './types/utility';
import { Forwards } from './forwards';
import { SubscriptionManager } from './subscriptionManager';
import { DownstreamManager } from './downstreamManager';
import { MaterializedBusOptions } from './types/options';

export namespace EventDispatcher {
  export type Params<TEventMap extends EventMap> = {
    forwards: Pick<Forwards, 'begin'|'end'|'flush'>;
    subscriptions: Pick<SubscriptionManager<TEventMap>, 'consumeEvent'>;
    downstream: Pick<DownstreamManager<TEventMap>, 'propagate'>;
    options: Pick<MaterializedBusOptions, 'onUnhandledEvent'>;
  };
}

@autobind
export class EventDispatcher<TEventMap extends EventMap = EventMap> {

  private readonly forwards!: Pick<Forwards, 'begin'|'end'|'flush'>;
  private readonly subscriptions!: Pick<SubscriptionManager<TEventMap>, 'consumeEvent'>;
  private readonly downstream!: Pick<DownstreamManager<TEventMap>, 'propagate'>;
  private readonly options!: Pick<MaterializedBusOptions, 'onUnhandledEvent'>;

  constructor(params: EventDispatcher.Params<TEventMap>) {
    this.forwards = params.forwards;
    this.subscriptions = params.subscriptions;
    this.downstream = params.downstream;
    this.options = params.options;
  }

  public dispatchEvent<T extends EventKeys<TEventMap>>(event: T, payload: TEventMap[T]): boolean {
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