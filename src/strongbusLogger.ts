import {autobind} from 'core-decorators';

import type {ListenerThresholds, LogLevel, NoticeOptions} from './types/options';
import type {Logger, LoggerProvider} from './types/logger';
import type {EventKeys} from './types/utility';
import {type EventMap, WILDCARD} from './types/events';


@autobind
export class StrongbusLogger<TEventMap extends EventMap = EventMap> {
  private readonly name: string;
  private readonly provider: LoggerProvider;
  private readonly thresholds: Required<ListenerThresholds>;
  private readonly notices: Required<NoticeOptions>;
  private readonly verbose: boolean;

  constructor(params: {
    name: string;
    provider: LoggerProvider;
    thresholds: Required<ListenerThresholds>;
    notices: Required<NoticeOptions>;
    verbose: boolean;
  }) {
    Object.assign(this, params);
  }

  public onAddListener(event: EventKeys<TEventMap>|WILDCARD, n: number) {
    (this.verbose
      ? this.onAddListenerVerbose
      : this.onAddListenerNonVerbose
    )(event, n);
  }

  public onDuplicateSubscription(
    event: EventKeys<TEventMap>|WILDCARD,
    modes: {existingIncognito: boolean; requestedIncognito: boolean}
  ): void {
    const level = this.notices.duplicateSubscription;
    if(level === 'never') {
      return;
    }
    this.notice(
      level,
      StrongbusLogMessages.duplicateSubscription(
        this.name,
        event,
        modes.existingIncognito !== modes.requestedIncognito
          ? {
              existingIncognito: modes.existingIncognito,
              requestedIncognito: modes.requestedIncognito
            }
          : undefined
      )
    );
  }

  private onAddListenerNonVerbose(event: EventKeys<TEventMap>|WILDCARD, n: number) {
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

  private onAddListenerVerbose(event: EventKeys<TEventMap>|WILDCARD, count: number) {
    const {thresholds} = this;
    if(count > thresholds.error) {
      this.logErrorThresholdExceededVerbose(event, count);
    } else if(count > thresholds.warn) {
      this.logWarnThresholdExceededVerbose(event, count);
    } else if(count > thresholds.info) {
      this.logInfoThresholdExceededVerbose(event, count);
    }
  }

  private logInfoThresholdReached(event: EventKeys<TEventMap>|WILDCARD) {
    const {name, thresholds} = this;
    this.info(StrongbusLogMessages.infoThresholdReached(name, thresholds.info, event));
  }

  private logWarningThresholdReached(event: EventKeys<TEventMap>|WILDCARD) {
    const {name, thresholds} = this;
    this.info(StrongbusLogMessages.warnThresholdReached(name, thresholds.warn, event));
  }

  private logErrorThresholdReached(event: EventKeys<TEventMap>|WILDCARD) {
    const {name, thresholds} = this;
    this.info(StrongbusLogMessages.errorThresholdReached(name, thresholds.error, event));
  }

  private logErrorThresholdExceeded(event: EventKeys<TEventMap>|WILDCARD, count: number) {
    const {name, thresholds} = this;
    this.error(StrongbusLogMessages.errorThresholdExceeded(name, thresholds.error, count, event));
  }

  private logWarnThresholdExceeded(event: EventKeys<TEventMap>|WILDCARD, count: number) {
    const {name, thresholds} = this;
    this.warn(StrongbusLogMessages.warnThresholdExceeded(name, thresholds.warn, count, event));
  }

  private logInfoThresholdExceeded(event: EventKeys<TEventMap>|WILDCARD, count: number) {
    const {name, thresholds} = this;
    this.info(StrongbusLogMessages.infoThresholdExceeded(name, thresholds.info, count, event));
  }

  private logErrorThresholdExceededVerbose(event: EventKeys<TEventMap>|WILDCARD, count: number) {
    const {name, thresholds} = this;
    this.error(`Potential Memory Leak. ${name} has ${count} listeners for "${String(event)}", exceeds threshold set to ${thresholds.error}`);
  }

  private logWarnThresholdExceededVerbose(event: EventKeys<TEventMap>|WILDCARD, count: number) {
    const {name, thresholds} = this;
    this.warn(`Potential Memory Leak. ${name} has ${count} listeners for "${String(event)}", exceeds threshold set to ${thresholds.warn}`);
  }

  private logInfoThresholdExceededVerbose(event: EventKeys<TEventMap>|WILDCARD, count: number) {
    const {name, thresholds} = this;
    this.info(`${name} has ${count} listeners for "${String(event)}", ${thresholds.info} max listeners expected.`);
  }

  public onListenerRemoved(event: EventKeys<TEventMap>|WILDCARD, count: number): void {
    const {name, thresholds} = this;
    if(count === thresholds.error - 1) {
      this.info(StrongbusLogMessages.memoryPressureReducedBelowErrorThreshold(name, thresholds, count, event));
    } else if(count === thresholds.warn - 1) {
      this.info(StrongbusLogMessages.memoryPressureReducedBelowWarnThreshold(name, thresholds, count, event));
    } else if(count === thresholds.info - 1) {
      this.info(StrongbusLogMessages.memoryPressureReducedBelowInfoThreshold(name, count, event));
    }
  }

  public notice(level: Exclude<LogLevel, 'never'>, ...args: any[]): void {
    this[level](...args);
  }

  public debug(...args: any[]): void {
    this.impl.debug(...args);
  }

  public info(...args: any[]): void {
    this.impl.info(...args);
  }

  public warn(...args: any[]): void {
    this.impl.warn(...args);
  }

  public error(...args: any[]): void {
    this.impl.error(...args);
  }

  private _impl: Logger;
  private get impl(): Logger {
    if(!this._impl) {
      this._impl = typeof this.provider === 'function' ? this.provider() : this.provider;
    }
    return this._impl;
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

  public static duplicateSubscription(
    name: string,
    event: any,
    modeMismatch?: {existingIncognito: boolean; requestedIncognito: boolean}
  ): string {
    let message = `${name}: duplicate subscription for "${String(event)}"; the existing Subscription was returned`;
    if(modeMismatch) {
      const from = modeMismatch.existingIncognito ? 'incognito' : 'monitored';
      const to = modeMismatch.requestedIncognito ? 'incognito' : 'monitored';
      message += `; attempted to change monitoring mode from ${from} to ${to} (ignored, first registration wins)`;
    }
    return message;
  }
}
