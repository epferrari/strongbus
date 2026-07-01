export type Event = string|number|symbol;

/**
 * `{[event: Event]: Payload}`
 */
 export type EventMap = object;

/**
 * Subscription `s` can be released by invoking it directly (`s()`),
 * or invoking `s.unsubscribe()`
 */
export interface Subscription {
    (): void;
    unsubscribe: () => void;
}

export type WILDCARD = '*';
export const WILDCARD: WILDCARD = '*';
export type Listenable<E extends Event> = E|E[]|WILDCARD;

/**
 * Specific events only (no `'*'` wildcard). Required by {@link Bus.next} triggers.
 *
 * `next` always resolves on the first matching event and cannot correlate event
 * names with payload types when `'*'` is used. Use {@link Bus.scan} with a
 * `'*'` {@link Listenable} trigger when you need to react to any event but only
 * resolve after discriminating in the evaluator.
 */
export type SubscribableListenable<E extends Event> = E|E[];
