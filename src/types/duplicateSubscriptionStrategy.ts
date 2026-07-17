/**
 * One logical unit vs a stack of frames — used for observability, invocation, and disposal.
 */
export type DuplicateIntentMode = 'collapse' | 'stack';

export type DuplicateLogLevel = 'never' | 'debug' | 'info' | 'warn' | 'error';

/**
 * How duplicate SubscriptionSurface registrations for the same listenable + handler
 * affect counting, emit, dispose, and logging.
 */
export type DuplicateSubscriptionStrategy = {
  /** IntrospectionSurface + MonitoringSurface counting / lifecycle. */
  observability: DuplicateIntentMode;
  /** Emit-phase handler calls. */
  invocation: DuplicateIntentMode;
  /** How much intent `sub()` / `off()` releases (`on` / `any` / `pipe` only). */
  disposal: DuplicateIntentMode;
  /** Log when duplicate intent is registered. */
  logLevel: DuplicateLogLevel;
};

export const DEFAULT_DUPLICATE_SUBSCRIPTION_STRATEGY: DuplicateSubscriptionStrategy = {
  observability: 'collapse',
  invocation: 'collapse',
  disposal: 'collapse',
  logLevel: 'warn'
};

/**
 * Named presets for {@link DuplicateSubscriptionStrategy}. Knobs remain the source of truth;
 * these are sugar aligned with familiar host APIs and common app patterns.
 */
export const DuplicateSubscriptionStrategy = {
  /**
   * Like Node `EventEmitter`: duplicate `on` stacks; emit N times; `off` / dispose pops one.
   */
  EventEmitter: {
    observability: 'stack',
    invocation: 'stack',
    disposal: 'stack',
    logLevel: 'never'
  } as DuplicateSubscriptionStrategy,

  /**
   * Like DOM `EventTarget`: same (type, listener) is a no-op add; one invoke; remove clears it.
   */
  EventTarget: {
    observability: 'collapse',
    invocation: 'collapse',
    disposal: 'collapse',
    logLevel: 'never'
  } as DuplicateSubscriptionStrategy,

  /**
   * Shared handler, independent owners (e.g. modules A/B both `on('foo', S.method)`).
   * One invoke; dispose / `off` pops one owner’s frame.
   */
  SharedHandler: {
    observability: 'stack',
    invocation: 'collapse',
    disposal: 'stack',
    logLevel: 'never'
  } as DuplicateSubscriptionStrategy
};
