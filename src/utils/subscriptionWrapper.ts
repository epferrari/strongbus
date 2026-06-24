import {Subscription} from '../types/events';

export function subscriptionWrapper(dispose: () => void): Subscription {
    const sub: Subscription = () => dispose() as any;
    sub.unsubscribe = dispose;
    return sub;
}