import type {LoggerProvider} from './logger';
import type {DuplicateSubscriptionStrategy} from './duplicateSubscriptionStrategy';
import type {LeakDetectionOptions, ListenerThresholds, Options} from './options';

/**
 * {@link LeakDetectionOptions} after defaults are applied. `enabled` is `false` once
 * `leakDetection: false` is merged in, and the other settings are kept so a later
 * `leakDetection` object turns detection back on with them.
 * @internal
 */
export type MaterializedLeakDetection = {
  enabled: boolean;
  thresholds: Required<ListenerThresholds>;
  cadence: Required<LeakDetectionOptions>['cadence'];
};

/**
 * Bus options after defaults are applied — every field is present and nested
 * shapes (`leakDetection`, `duplicateSubscriptionStrategy`) are fully filled in.
 * The deprecated `thresholds` and `verbose` are folded into `leakDetection`.
 * `logger` stays optional; when omitted, logging falls back to a built-in console adapter.
 * @internal
 */
export type MaterializedBusOptions = Omit<
  Required<Options>,
  'duplicateSubscriptionStrategy' | 'leakDetection' | 'thresholds' | 'verbose' | 'logger'
> & {
  leakDetection: MaterializedLeakDetection;
  duplicateSubscriptionStrategy: DuplicateSubscriptionStrategy;
  logger?: LoggerProvider;
};

/**
 * Merge leak-detection overrides onto `base`. The deprecated `thresholds` and `verbose`
 * apply first, so `leakDetection` wins where both set the same thing.
 * @internal
 */
export function resolveLeakDetection(
  base: MaterializedLeakDetection,
  overrides: Pick<Options, 'leakDetection' | 'thresholds' | 'verbose'>
): MaterializedLeakDetection {
  const {leakDetection, thresholds, verbose} = overrides;
  const legacy: MaterializedLeakDetection = {
    ...base,
    thresholds: {...base.thresholds, ...thresholds},
    cadence: verbose === undefined ? base.cadence : (verbose ? 'every' : 'boundary')
  };
  if(leakDetection === false) {
    return {...legacy, enabled: false};
  } else if(leakDetection === undefined) {
    return legacy;
  }
  return {
    enabled: true,
    thresholds: {...legacy.thresholds, ...leakDetection.thresholds},
    cadence: leakDetection.cadence ?? legacy.cadence
  };
}

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
