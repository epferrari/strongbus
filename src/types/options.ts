
import type {LoggerProvider} from './logger';

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
 * Log level for a configurable bus notice, or `'never'` to silence it.
 */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'never';

/**
 * Per-notice log levels. Each defaults independently; omit a key to keep the default.
 */
export interface NoticeOptions {
  /**
   * Re-subscribe of the same `(event, handler)` pair (idempotent `on` / `addListener`).
   * Default `'warn'`. Includes extra copy when the second call attempts to change
   * monitored vs incognito mode (first registration still wins).
   */
  duplicateSubscription?: LogLevel;
}

/**
 * @prop allowUnhandledEvents `true` - Should the Bus throw an error when an event is emitted and there are no listeners for the event
 * @prop name `"Anonymous"` - A name for the bus. Included in warn/info/error potential memory leak messages and unhandled event errors thrown
 * @prop thresholds {@link ListenerThresholds}
 * @prop logger {@link Logger | () => Logger} [`console`] - How to log potential memory leaks, if thresholds are < Infinity
 * @prop verbose [false] - should memory leak warnings be output on every listener added above the thresholds, or only at intervals
 * @prop coalesceDownstreamLifecycleEvents [true] - when true, coalesce will/did add/remove hooks to one
 * emission per event key during `pipe()` / `unpipe()` reconcile of a heavily-subscribed downstream bus
 * @prop notices {@link NoticeOptions} - per-notice log levels (`error`/`warn`/`info`/`debug`/`never`)
 */
export interface Options {
  allowUnhandledEvents?: boolean;
  name?: string;
  thresholds?: Partial<ListenerThresholds>;
  logger?: LoggerProvider;
  verbose?: boolean;
  coalesceDownstreamLifecycleEvents?: boolean;
  notices?: NoticeOptions;
}

/** Options accepted by {@link Bus.configure}; `name` is per-instance only. */
export type ConfigurableBusOptions = Omit<Partial<Options>, 'name'>;
