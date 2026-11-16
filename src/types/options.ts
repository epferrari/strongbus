
import type {LoggerProvider, LogLevel} from './logger';
import type {DuplicateSubscriptionStrategy} from './duplicateSubscriptionStrategy';

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
 * Memory-leak detection for a bus's own listeners. Logs go through {@link Options.logger}.
 * @prop thresholds {@link ListenerThresholds} - per-event listener counts at which to log, merged key-by-key onto defaults
 * @prop cadence [`'boundary'`] - `'boundary'` logs at threshold crossings and their multiples;
 * `'every'` logs on every listener added above a threshold
 * @prop pipeEdges [`false`] - whether edges to buses this bus pipes into count toward its leak detection.
 * `true` counts each edge as one listener for `'*'`, alongside `tap` handlers and against `thresholds`.
 * `{thresholds}` counts edges on their own, against these thresholds (unset keys fall back to `thresholds`).
 * Incognito edges count too. Listeners on the downstream bus never count here.
 */
export interface LeakDetectionOptions {
  thresholds?: Partial<ListenerThresholds>;
  cadence?: 'boundary'|'every';
  pipeEdges?: boolean|{thresholds: Partial<ListenerThresholds>};
}

/**
 * @prop onUnhandledEvent [`'ignore'`] — what to do when an event is emitted with no listeners:
 * `'ignore'` (default no-op), `'throw'`, or a custom `(event, payload) => void` callback
 * @prop name `"Anonymous"` - A name for the bus. Included in warn/info/error potential memory leak messages and unhandled event errors thrown
 * @prop leakDetection {@link LeakDetectionOptions} - memory-leak detection settings, or `false` to turn it off
 * @prop thresholds - deprecated, use `leakDetection.thresholds`. Overridden by `leakDetection` when both are set
 * @prop logger {@link Logger | () => Logger} - Where Strongbus logs, including potential memory leaks. When omitted, a built-in console adapter is used.
 * @prop verbose - deprecated, use `leakDetection.cadence` (`true` is `'every'`). Overridden by `leakDetection` when both are set
 * @prop coalesceDownstreamLifecycleEvents [true] - when true, coalesce will/did add/remove hooks to one
 * emission per event key during `pipe()` / `unpipe()` reconcile of a heavily-subscribed downstream bus
 * @prop duplicateSubscriptionStrategy - how duplicate listenable+handler registrations behave
 * @prop onUseAfterDestroy [false] - what to do when a monitoring or subscription method is called
 * after `destroy()`: `false` runs it as usual; a {@link LogLevel} logs
 * `StrongbusLogCode.UseAfterDestroy`, then skips it and returns an inert stub;
 * `'throw'` throws instead. When set to any of these, `emit` and `destroy` become silent no-ops.
 * Introspection is never affected. Calls made while `destroy()` is still running are skipped and
 * logged at debug under every setting, including `false`.
 * @prop suppressDefaultUnhandledErrorLogging [true] - when a handler throws or rejects and the bus has
 * no `error` hook, `true` drops the error; `false` logs `StrongbusLogCode.UnhandledError` through `logger`.
 * The default will change to `false` in the next major version.
 */
export interface Options {
  name?: string;
  leakDetection?: false|LeakDetectionOptions;
  /** @deprecated Use `leakDetection.thresholds`. */
  thresholds?: Partial<ListenerThresholds>;
  logger?: LoggerProvider;
  /** @deprecated Use `leakDetection.cadence`. */
  verbose?: boolean;
  coalesceDownstreamLifecycleEvents?: boolean;
  duplicateSubscriptionStrategy?: Partial<DuplicateSubscriptionStrategy>;
  onUnhandledEvent?: 'throw'|'ignore'|((event: string|number|symbol, payload: unknown) => void);
  onUseAfterDestroy?: false|Exclude<LogLevel, 'never'>|'throw';
  suppressDefaultUnhandledErrorLogging?: boolean;
}

/** Options accepted by {@link Bus.configure}; `name` is per-instance only. */
export type ConfigurableBusOptions = Omit<Partial<Options>, 'name'>;
