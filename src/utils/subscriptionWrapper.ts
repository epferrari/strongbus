import type {Subscription} from '../types/events';
import {unnamed} from './unnamed';

export function subscriptionWrapper(dispose: () => void): Subscription {
    const sub: Subscription = unnamed(() => dispose() as any) as Subscription;
    sub.unsubscribe = dispose;
    return sub;
}