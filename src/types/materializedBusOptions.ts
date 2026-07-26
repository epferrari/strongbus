import type {LoggerProvider} from './logger';
import type {DuplicateSubscriptionStrategy} from './duplicateSubscriptionStrategy';
import type {ListenerThresholds, Options} from './options';

/**
 * Bus options after defaults are applied — every field is present and nested
 * shapes (`thresholds`, `duplicateSubscriptionStrategy`) are fully filled in.
 * `logger` stays optional; when omitted, logging falls back to a built-in console adapter.
 * @internal
 */
export type MaterializedBusOptions = Omit<
  Required<Options>,
  'duplicateSubscriptionStrategy' | 'thresholds' | 'logger'
> & {
  thresholds: Required<ListenerThresholds>;
  duplicateSubscriptionStrategy: DuplicateSubscriptionStrategy;
  logger?: LoggerProvider;
};

const DEFAULT_DUPLICATE_SUBSCRIPTION_STRATEGY: DuplicateSubscriptionStrategy = {
  observability: 'collapse',
  invocation: 'collapse',
  disposal: 'collapse',
  logLevel: 'warn'
};

/**
 * Merge a partial strategy onto the built-in defaults.
 * @internal
 */
export function resolveDuplicateSubscriptionStrategy(
  partial?: Partial<DuplicateSubscriptionStrategy>
): DuplicateSubscriptionStrategy {
  return {
    ...DEFAULT_DUPLICATE_SUBSCRIPTION_STRATEGY,
    ...partial
  };
}

/** @internal */
export const DEFAULT_NAME = 'Anonymous';

let i = 0;
/**
 * Disambiguate the default bus name with a monotonic suffix.
 * @internal
 */
export function uniqueName(name: string): string {
  if(name === DEFAULT_NAME) {
    return `${name}<${i++}>`;
  }
  return name;
}
