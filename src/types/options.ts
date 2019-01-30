
import {Logger} from './logger';

/**
 * @description notify of possible memory leaks
 * @prop info [100] - log info when listener count for an event exceeds this threshold
 * @prop warn [500] - log warn when listener count for an event exeeds this.threshold
 * @prop error [Infinity] - log error total listener count for an event exceeds this threshold
 */
export interface ListenerThresholds {
  info: number;
  warn: number;
  error: number;
}

/**
 * @prop allowUnhandledEvents [true] - should the Bus throw an error when an event is emitted and there are no listeners
 * @prop name [Anonymous] - a name for the bus. included in warn/info messages and errors thrown
 * @prop thresholds
 */
export interface Options {
  allowUnhandledEvents?: boolean;
  name?: string;
  thresholds?: Partial<ListenerThresholds>;
  logger?: Logger;
}