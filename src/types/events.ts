
export type Event = string;
export type Subscription = () => void;

export type WILDCARD = '*';
export const WILDCARD: WILDCARD = '*';
export type Listenable<E extends Event> = E|E[]|WILDCARD;