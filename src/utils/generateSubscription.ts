import * as Events from '../types/events';

export function generateSubscription(dispose: () => void): Events.Subscription {
    const sub: Events.Subscription = () => dispose() as any;
    sub.unsubscribe = dispose;
    return sub;
}