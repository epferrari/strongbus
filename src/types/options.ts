
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
 * @prop allowUnhandledEvents `true` - Should the Bus throw an error when an event is emitted and there are no listeners for the event
 * @prop name `"Anonymous"` - A name for the bus. Included in warn/info/error potential memory leak messages and unhandled event errors thrown
 * @prop thresholds {@link ListenerThresholds}
 * @prop logger {@link Logger | () => Logger} [`console`] - How to log potential memory leaks, if thresholds are < Infinity
 * @prop verbose - should memory leak warnings be output on every listener added above the thresholds, or only at intervals
 * @prop coalesceDownstreamLifecycle - when true, coalesce will/did add/remove hooks to one
 * emission per event key during `pipe()` / `unpipe()` reconcile of a heavily-subscribed downstream bus
 */
export interface Options {
  allowUnhandledEvents?: boolean;
  name?: string;
  thresholds?: Partial<ListenerThresholds>;
  logger?: LoggerProvider;
  verbose?: boolean;
  coalesceDownstreamLifecycle?: boolean;
}