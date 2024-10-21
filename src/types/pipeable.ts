import * as Events from './events';
import * as EventHandlers from './eventHandlers';
import {Lifecycle} from './lifecycle';
import {EventKeys, EventPayload} from './utility';

export interface Pipeable<T extends Events.EventMap> {
  emit<E extends EventKeys<T>>(event: E, ...payload: EventPayload<T, E>): boolean;

  hook<L extends Lifecycle>(
    event: L,
    handler: (payload: Lifecycle.EventMap<T>[L]) => void
  ): Events.Subscription;

  listeners: (
    ReadonlyMap<EventKeys<any>|Events.WILDCARD, ReadonlySet<EventHandlers.GenericHandler>>|
    ReadonlyMap<string, ReadonlySet<EventHandlers.GenericHandler>>
  );

  pipe<P>(target: P extends Pipeable<infer U>
    ? U extends T
      ? P
      : never
    : never
  ): P;
}

