
import type {LoggerProvider} from './logger';
import {
  DEFAULT_DUPLICATE_SUBSCRIPTION_STRATEGY,
  type DuplicateSubscriptionStrategy
} from './duplicateSubscriptionStrategy';

export * from './duplicateSubscriptionStrategy';

/**
 * Notify of possible memory leaks.
 * @prop info [default=`100`] - log info when listener count for an event exceeds this threshold
 * @prop warn [default=`500`] - log warn when listener count for an event exeeds this.threshold
 * @prop error [default=`Infinity`] - log error total listener count for an event exceeds this threshold
 */
export interface ListenerThresholds {
  info: number;
  warn: number;
  error: number;
}

/**
 * @prop onUnhandledEvent [`'ignore'`] — what to do when an event is emitted with no listeners:
 * `'ignore'` (default no-op), `'throw'`, or a custom `(event, payload) => void` callback
 * @prop name `"Anonymous"` - A name for the bus. Included in warn/info/error potential memory leak messages and unhandled event errors thrown
 * @prop thresholds {@link ListenerThresholds}
 * @prop logger {@link Logger | () => Logger} - How to log potential memory leaks, if thresholds are < Infinity. When omitted, a built-in console adapter is used.
 * @prop verbose [false] - should memory leak warnings be output on every listener added above the thresholds, or only at intervals
 * @prop coalesceDownstreamLifecycleEvents [true] - when true, coalesce will/did add/remove hooks to one
 * emission per event key during `pipe()` / `unpipe()` reconcile of a heavily-subscribed downstream bus
 * @prop duplicateSubscriptionStrategy - how duplicate listenable+handler registrations behave
 */
export interface Options {
  name?: string;
  thresholds?: Partial<ListenerThresholds>;
  logger?: LoggerProvider;
  verbose?: boolean;
  coalesceDownstreamLifecycleEvents?: boolean;
  duplicateSubscriptionStrategy?: Partial<DuplicateSubscriptionStrategy>;
  onUnhandledEvent?: 'throw'|'ignore'|((event: string|number|symbol, payload: unknown) => void);
}

/** Options accepted by {@link Bus.configure}; `name` is per-instance only. */
export type ConfigurableBusOptions = Omit<Partial<Options>, 'name'>;

/**
 * Bus options after defaults are applied — every field is present and nested
 * shapes (`thresholds`, `duplicateSubscriptionStrategy`) are fully filled in.
 * `logger` stays optional; when omitted, logging falls back to a built-in console adapter.
 */
export type MaterializedBusOptions = Omit<
  Required<Options>,
  'duplicateSubscriptionStrategy' | 'thresholds' | 'logger'
> & {
  thresholds: Required<ListenerThresholds>;
  duplicateSubscriptionStrategy: DuplicateSubscriptionStrategy;
  logger?: LoggerProvider;
};

export function resolveDuplicateSubscriptionStrategy(
  partial?: Partial<DuplicateSubscriptionStrategy>
): DuplicateSubscriptionStrategy {
  return {
    ...DEFAULT_DUPLICATE_SUBSCRIPTION_STRATEGY,
    ...partial
  };
}

export const DEFAULT_NAME = 'Anonymous';

let i = 0;
export function uniqueName(name: string): string {
  if(name === DEFAULT_NAME) {
    return `${name}<${i++}>`;
  }
  return name;
}
