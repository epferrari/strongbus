import {autobind} from 'core-decorators';

import type {ListenerThresholds} from './types/options';
import {
  StrongbusLogCode,
  type Logger,
  type LoggerProvider,
  type StrongbusLogRecord
} from './types/logger';
import type {EventKeys} from './types/utility';
import {type EventMap, WILDCARD} from './types/events';

export {
  StrongbusLogCode,
  type StrongbusLogRecord
} from './types/logger';

export type ErrorHandlerFailureDetails = {
  errorHandler?: string;
  errorHandlerError: unknown;
  originalEvent: unknown;
  eventHandlerError: unknown;
};

export type DuplicateLogLevel = 'never' | 'debug' | 'info' | 'warn' | 'error';

@autobind
export class StrongbusLogger<TEventMap extends EventMap = EventMap> {
  private readonly name: string;
  private readonly provider: LoggerProvider;
  private readonly thresholds: Required<ListenerThresholds>;
  private readonly verbose: boolean;

  constructor(params: {name: string, provider: LoggerProvider, thresholds: Required<ListenerThresholds>, verbose: boolean}) {
    Object.assign(this, params);
  }

  public onAddListener(event: EventKeys<TEventMap>|WILDCARD, n: number) {
    (this.verbose
      ? this.onAddListenerVerbose
      : this.onAddListenerNonVerbose
    )(event, n);
  }

  public onListenerRemoved(event: EventKeys<TEventMap>|WILDCARD, count: number): void {
    const {name, thresholds} = this;
    if(count === thresholds.error - 1) {
      this.info(buildMemoryPressureReducedBelowErrorThreshold(name, thresholds, count, event));
    } else if(count === thresholds.warn - 1) {
      this.info(buildMemoryPressureReducedBelowWarnThreshold(name, thresholds, count, event));
    } else if(count === thresholds.info - 1) {
      this.info(buildMemoryPressureReducedBelowInfoThreshold(name, count, event));
    }
  }

  public onDuplicateSubscription(
    kind: string,
    listenable: string,
    level: DuplicateLogLevel
  ): void {
    if(level === 'never') {
      return;
    }
    this[level](buildDuplicateSubscription(this.name, kind, listenable));
  }

  public onUnsoundPipeGraph(source: string, dest: string): void {
    this.warn(buildUnsoundPipeGraph(this.name, source, dest));
  }

  public onUnsoundPipeGraphResolved(source: string, dest: string): void {
    this.info(buildUnsoundPipeGraphResolved(this.name, source, dest));
  }

  public onUnsoundPipeEdgeFilterUpgrade(dest: string): void {
    this.warn(buildUnsoundPipeEdgeFilterUpgrade(this.name, dest));
  }

  public onErrorHandlerFailed(details: ErrorHandlerFailureDetails): void {
    this.error(buildErrorHandlerFailed(details));
  }

  public onAsyncErrorHandlerFailed(details: ErrorHandlerFailureDetails): void {
    this.error(buildAsyncErrorHandlerFailed(details));
  }

  private onAddListenerNonVerbose(event: EventKeys<TEventMap>|WILDCARD, n: number) {
    const {thresholds} = this;
    if(n === thresholds.info) {
      this.info(buildInfoThresholdReached(this.name, thresholds.info, event));
    } else if(n === thresholds.warn) {
      this.info(buildWarnThresholdReached(this.name, thresholds.warn, event));
    } else if(n === thresholds.error) {
      this.info(buildErrorThresholdReached(this.name, thresholds.error, event));
    } else if(
      n === thresholds.error + 1 || (
        n > thresholds.error && (
          n % thresholds.error === 0 ||
          n % thresholds.info === 0
        )
      )
    ) {
      this.error(buildErrorThresholdExceeded(this.name, thresholds.error, n, event));
    } else if (
      n === thresholds.warn + 1 || (
        n > thresholds.warn && (
          n % thresholds.warn === 0 ||
          n % thresholds.info === 0
        )
      )
    ) {
      this.warn(buildWarnThresholdExceeded(this.name, thresholds.warn, n, event));
    } else if(
      n === thresholds.info + 1 || (
        n > thresholds.info && n % thresholds.info === 0
    )) {
      this.info(buildInfoThresholdExceeded(this.name, thresholds.info, n, event));
    }
  }

  private onAddListenerVerbose(event: EventKeys<TEventMap>|WILDCARD, count: number) {
    const {name, thresholds} = this;
    if(count > thresholds.error) {
      this.error({
        code: StrongbusLogCode.ErrorThresholdExceeded,
        message: `Potential Memory Leak. ${name} has ${count} listeners for "${String(event)}", exceeds threshold set to ${thresholds.error}`
      });
    } else if(count > thresholds.warn) {
      this.warn({
        code: StrongbusLogCode.WarnThresholdExceeded,
        message: `Potential Memory Leak. ${name} has ${count} listeners for "${String(event)}", exceeds threshold set to ${thresholds.warn}`
      });
    } else if(count > thresholds.info) {
      this.info({
        code: StrongbusLogCode.InfoThresholdExceeded,
        message: `${name} has ${count} listeners for "${String(event)}", ${thresholds.info} max listeners expected.`
      });
    }
  }

  private info(logRecord: StrongbusLogRecord): void {
    this.impl.info(logRecord);
  }

  private warn(logRecord: StrongbusLogRecord): void {
    this.impl.warn(logRecord);
  }

  private error(logRecord: StrongbusLogRecord): void {
    this.impl.error(logRecord);
  }

  private debug(logRecord: StrongbusLogRecord): void {
    this.impl.debug(logRecord);
  }

  private _impl: Logger;
  private get impl(): Logger {
    if(!this._impl) {
      this._impl = typeof this.provider === 'function' ? this.provider() : this.provider;
    }
    return this._impl;
  }
}

function buildInfoThresholdReached(name: string, threshold: number, event: any): StrongbusLogRecord {
  return {
    code: StrongbusLogCode.InfoThresholdReached,
    message: `${name} has reached expected max listeners (${threshold}) for "${event}"`
  };
}

function buildWarnThresholdReached(name: string, threshold: number, event: any): StrongbusLogRecord {
  return {
    code: StrongbusLogCode.WarnThresholdReached,
    message: `${name} has reached warning threshold (${threshold}) of listeners for "${event}"`
  };
}

function buildErrorThresholdReached(name: string, threshold: number, event: any): StrongbusLogRecord {
  return {
    code: StrongbusLogCode.ErrorThresholdReached,
    message: `${name} has reached error threshold (${threshold}) of listeners for "${event}"`
  };
}

function buildErrorThresholdExceeded(name: string, threshold: number, actual: number, event: any): StrongbusLogRecord {
  return {
    code: StrongbusLogCode.ErrorThresholdExceeded,
    message: `Potential Memory Leak. ${name} has ${actual} listeners for "${event}", exceeds error threshold set to ${threshold}`
  };
}

function buildWarnThresholdExceeded(name: string, threshold: number, actual: number, event: any): StrongbusLogRecord {
  return {
    code: StrongbusLogCode.WarnThresholdExceeded,
    message: `Potential Memory Leak. ${name} has ${actual} listeners for "${event}", exceeds warning threshold set to ${threshold}`
  };
}

function buildInfoThresholdExceeded(name: string, threshold: number, actual: number, event: any): StrongbusLogRecord {
  return {
    code: StrongbusLogCode.InfoThresholdExceeded,
    message: `${name} has ${actual} listeners for "${event}", ${threshold} max listeners expected.`
  };
}

function buildMemoryPressureReducedBelowErrorThreshold(
  name: string,
  thresholds: ListenerThresholds,
  count: number,
  event: any
): StrongbusLogRecord {
  return {
    code: StrongbusLogCode.MemoryPressureReducedBelowErrorThreshold,
    message: `${name}'s listener count of ${count} for "${event}" has crossed below error threshold (${thresholds.error}). Still above warning threshold (${thresholds.warn})`
  };
}

function buildMemoryPressureReducedBelowWarnThreshold(
  name: string,
  thresholds: ListenerThresholds,
  count: number,
  event: any
): StrongbusLogRecord {
  return {
    code: StrongbusLogCode.MemoryPressureReducedBelowWarnThreshold,
    message: `${name}'s listener count of ${count} for "${event}" has crossed below warning threshold (${thresholds.warn}). Still above max expected (${thresholds.info})`
  };
}

function buildMemoryPressureReducedBelowInfoThreshold(name: string, count: number, event: any): StrongbusLogRecord {
  return {
    code: StrongbusLogCode.MemoryPressureReducedBelowInfoThreshold,
    message: `${name}'s listener count of ${count} for "${event}" is now within the expected range`
  };
}

function buildDuplicateSubscription(name: string, kind: string, listenable: string): StrongbusLogRecord {
  return {
    code: StrongbusLogCode.DuplicateSubscription,
    message: `${name}: duplicate ${kind} subscription for "${listenable}" (same handler reference)`
  };
}

function buildUnsoundPipeGraph(bridge: string, source: string, dest: string): StrongbusLogRecord {
  return {
    code: StrongbusLogCode.UnsoundPipeGraph,
    message: [
      `Unsound pipe path ${source} → ${bridge} → ${dest}:`,
      `${bridge} is both a pipe target and a pipe source without a call-site filter on the edge to ${dest}.`,
      'Events can pass through this bus even when they are absent from its EventMap,',
      'so TypeScript cannot prove multi-hop payload safety.',
      'Use bus.pipe(predicate).pipe(dest) to allow or drop relayed events per edge,',
      'or avoid using this bus as a bridge. See https://epferrari.github.io/strongbus/docs/pipe_limitations.md.'
    ].join(' ')
  };
}

function buildUnsoundPipeGraphResolved(bridge: string, source: string, dest: string): StrongbusLogRecord {
  return {
    code: StrongbusLogCode.UnsoundPipeGraphResolved,
    message: `Unsound pipe path ${source} → ${bridge} → ${dest} was removed.`
  };
}

function buildUnsoundPipeEdgeFilterUpgrade(bridge: string, dest: string): StrongbusLogRecord {
  return {
    code: StrongbusLogCode.UnsoundPipeEdgeFilterUpgrade,
    message: [
      `${bridge} → ${dest}: cannot add a call-site filter to an existing unfiltered pipe edge.`,
      `Call unpipe(${dest}) first, then pipe(predicate).pipe(${dest}).`,
      'See https://epferrari.github.io/strongbus/docs/pipe_limitations.md.'
    ].join(' ')
  };
}

function buildErrorHandlerFailed(context: ErrorHandlerFailureDetails): StrongbusLogRecord {
  return {
    code: StrongbusLogCode.ErrorHandlerFailed,
    message: 'Error thrown in error handler',
    context
  };
}

function buildAsyncErrorHandlerFailed(context: ErrorHandlerFailureDetails): StrongbusLogRecord {
  return {
    code: StrongbusLogCode.AsyncErrorHandlerFailed,
    message: 'Error thrown in async error handler',
    context
  };
}

/**
 * Expected {@link StrongbusLogRecord} fixtures for specs. Prefer asserting against
 * these rather than hard-coding message text. Production call sites should use
 * {@link StrongbusLogger} domain methods instead.
 */
export class StrongbusLogMessages {
  public static infoThresholdReached = buildInfoThresholdReached;
  public static warnThresholdReached = buildWarnThresholdReached;
  public static errorThresholdReached = buildErrorThresholdReached;
  public static errorThresholdExceeded = buildErrorThresholdExceeded;
  public static warnThresholdExceeded = buildWarnThresholdExceeded;
  public static infoThresholdExceeded = buildInfoThresholdExceeded;
  public static memoryPressureReducedBelowErrorThreshold = buildMemoryPressureReducedBelowErrorThreshold;
  public static memoryPressureReducedBelowWarnThreshold = buildMemoryPressureReducedBelowWarnThreshold;
  public static memoryPressureReducedBelowInfoThreshold = buildMemoryPressureReducedBelowInfoThreshold;
  public static duplicateSubscription = buildDuplicateSubscription;
  public static unsoundPipeGraph = buildUnsoundPipeGraph;
  public static unsoundPipeGraphResolved = buildUnsoundPipeGraphResolved;
  public static unsoundPipeEdgeFilterUpgrade = buildUnsoundPipeEdgeFilterUpgrade;
  public static errorHandlerFailed = buildErrorHandlerFailed;
  public static asyncErrorHandlerFailed = buildAsyncErrorHandlerFailed;
}
