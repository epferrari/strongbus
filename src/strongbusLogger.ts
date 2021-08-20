import {autobind} from 'core-decorators';

import {ListenerThresholds} from './types/options';
import {Logger} from './types/logger';
import {EventKeys} from './types/utility';
import * as Events from './types/events';


@autobind
export class StrongbusLogger<TEventMap extends object = object> {
  private readonly name: string;
  private readonly logger: Logger;
  private readonly thresholds: Required<ListenerThresholds>;
  private readonly verbose: boolean;

  constructor(params: {name: string, logger: Logger, thresholds: Required<ListenerThresholds>, verbose: boolean}) {
    Object.assign(this, params);
  }

  public onAddListener(event: EventKeys<TEventMap>|Events.WILDCARD, n: number) {
    (this.verbose
      ? this.onAddListenerVerbose
      : this.onAddListenerNonVerbose
    )(event, n);
  }

  private onAddListenerNonVerbose(event: EventKeys<TEventMap>|Events.WILDCARD, n: number) {
    const {thresholds} = this;
    if(n === thresholds.info) {
      this.logInfoThresholdReached(event);
    } else if(n === thresholds.warn) {
      this.logWarningThresholdReached(event);
    } else if(n === thresholds.error) {
      this.logErrorThresholdReached(event);
    } else if(
      n === thresholds.error + 1 || (
        n > thresholds.error && (
          n % thresholds.error === 0 ||
          n % thresholds.info === 0
        )
      )
    ) {
      this.logErrorThresholdExceeded(event, n);
    } else if (
      n === thresholds.warn + 1 || (
        n > thresholds.warn && (
          n % thresholds.warn === 0 ||
          n % thresholds.info === 0
        )
      )
    ) {
      this.logWarnThresholdExceeded(event, n);
    } else if(
      n === thresholds.info + 1 || (
        n > thresholds.info && n % thresholds.info === 0
    )) {
      this.logInfoThresholdExceeded(event, n);
    }
  }

  private onAddListenerVerbose(event: EventKeys<TEventMap>|Events.WILDCARD, count: number) {
    const {thresholds} = this;
    if(count > thresholds.error) {
      this.logErrorThresholdExceededVerbose(event, count);
    } else if(count > thresholds.warn) {
      this.logWarnThresholdExceededVerbose(event, count);
    } else if(count > thresholds.info) {
      this.logInfoThresholdExceededVerbose(event, count);
    }
  }

  private logInfoThresholdReached(event: EventKeys<TEventMap>|Events.WILDCARD) {
    const {logger, thresholds} = this;
    logger.info(StrongbusLogMessages.infoThresholdReached(this.name, thresholds.info, event));
  }

  private logWarningThresholdReached(event: EventKeys<TEventMap>|Events.WILDCARD) {
    const {logger, thresholds} = this;
    logger.info(StrongbusLogMessages.warnThresholdReached(this.name, thresholds.warn, event));
  }

  private logErrorThresholdReached(event: EventKeys<TEventMap>|Events.WILDCARD) {
    const {logger, thresholds} = this;
    logger.info(StrongbusLogMessages.errorThresholdReached(this.name, thresholds.error, event));
  }

  private logErrorThresholdExceeded(event: EventKeys<TEventMap>|Events.WILDCARD, count: number) {
    const {logger, thresholds} = this;
    logger.error(StrongbusLogMessages.errorThresholdExceeded(this.name, thresholds.error, count, event));
  }

  private logWarnThresholdExceeded(event: EventKeys<TEventMap>|Events.WILDCARD, count: number) {
    const {logger, thresholds} = this;
    logger.warn(StrongbusLogMessages.warnThresholdExceeded(this.name, thresholds.warn, count, event));
  }

  private logInfoThresholdExceeded(event: EventKeys<TEventMap>|Events.WILDCARD, count: number) {
    const {logger, thresholds} = this;
    logger.info(StrongbusLogMessages.infoThresholdExceeded(this.name, thresholds.info, count, event));
  }

  private logErrorThresholdExceededVerbose(event: EventKeys<TEventMap>|Events.WILDCARD, count: number) {
    const {logger, thresholds} = this;
    logger.error(`Potential Memory Leak. ${this.name} has ${count} listeners for "${event}", exceeds threshold set to ${thresholds.error}`);
  }

  private logWarnThresholdExceededVerbose(event: EventKeys<TEventMap>|Events.WILDCARD, count: number) {
    const {logger, thresholds} = this;
    logger.warn(`Potential Memory Leak. ${this.name} has ${count} listeners for "${event}", exceeds threshold set to ${thresholds.warn}`);
  }

  private logInfoThresholdExceededVerbose(event: EventKeys<TEventMap>|Events.WILDCARD, count: number) {
    const {logger, thresholds} = this;
    logger.info(`${this.name} has ${count} listeners for "${event}", ${thresholds.info} max listeners expected.`);
  }

  public onListenerRemoved(event: EventKeys<TEventMap>|Events.WILDCARD, count: number): void {
    const {logger, thresholds} = this;
    if(count === thresholds.error - 1) {
      logger.info(StrongbusLogMessages.memoryPressureReducedBelowErrorThreshold(this.name, thresholds, count, event));
    } else if(count === thresholds.warn - 1) {
      logger.info(StrongbusLogMessages.memoryPressureReducedBelowWarnThreshold(this.name, thresholds, count, event));
    } else if(count === thresholds.info - 1) {
      logger.info(StrongbusLogMessages.memoryPressureReducedBelowInfoThreshold(this.name, count, event));
    }
  }
}

export class StrongbusLogMessages {

  public static infoThresholdReached(name: string, threshold: number, event: any): string {
    return `${name} has reached expected max listeners (${threshold}) for "${event}"`;
  }

  public static warnThresholdReached(name: string, threshold: number, event: any): string {
    return `${name} has reached warning threshold (${threshold}) of listeners for "${event}"`;
  }

  public static errorThresholdReached(name: string, threshold: number, event: any): string {
    return `${name} has reached error threshold (${threshold}) of listeners for "${event}"`;
  }

  public static errorThresholdExceeded(name: string, threshold: number, actual: number, event: any): string {
    return `Potential Memory Leak. ${name} has ${actual} listeners for "${event}", exceeds error threshold set to ${threshold}`;
  }

  public static warnThresholdExceeded(name: string, threshold: number, actual: number, event: any): string {
    return `Potential Memory Leak. ${name} has ${actual} listeners for "${event}", exceeds warning threshold set to ${threshold}`;
  }

  public static infoThresholdExceeded(name: string, threshold: number, actual: number, event: any): string {
    return `${name} has ${actual} listeners for "${event}", ${threshold} max listeners expected.`;
  }

  public static memoryPressureReducedBelowErrorThreshold(name: string, thresholds: ListenerThresholds, count: number, event: any): string {
    return `${name}'s listener count of ${count} for "${event}" has crossed below error threshold (${thresholds.error}). Still above warning threshold (${thresholds.warn})`;
  }

  public static memoryPressureReducedBelowWarnThreshold(name: string, thresholds: ListenerThresholds, count: number, event: any): string {
    return `${name}'s listener count of ${count} for "${event}" has crossed below warning threshold (${thresholds.warn}). Still above max expected (${thresholds.info})`;
  }

  public static memoryPressureReducedBelowInfoThreshold(name: string, count: number, event: any): string {
    return `${name}'s listener count of ${count} for "${event}" is now within the expected range`;
  }
}