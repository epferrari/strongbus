export type Event = string|number|symbol;

/**
 * {[event: Event]: Payload}
 */
 export type EventMap = object;

/**
 * Subscription can be released by invoking it directly,
 * or invoking <Subscription>.unsubscribe()
 */
export interface Subscription {
    (): void;
    unsubscribe: () => void;
}

export type WILDCARD = '*';
export const WILDCARD: WILDCARD = '*';
export type Listenable<E extends Event> = E|E[]|WILDCARD;
