/**
 * Stable numeric codes on {@link StrongbusLogRecord} for Strongbus-authored log
 * lines. Custom {@link Logger} implementations can discriminate on
 * `record.code` without parsing message text.
 */
export const StrongbusLogCode = {
  InfoThresholdReached: 1000,
  WarnThresholdReached: 1001,
  ErrorThresholdReached: 1002,
  InfoThresholdExceeded: 1003,
  WarnThresholdExceeded: 1004,
  ErrorThresholdExceeded: 1005,
  MemoryPressureReducedBelowErrorThreshold: 1006,
  MemoryPressureReducedBelowWarnThreshold: 1007,
  MemoryPressureReducedBelowInfoThreshold: 1008,
  DuplicateSubscription: 1009,
  UnsoundPipeGraph: 1010,
  UnsoundPipeGraphResolved: 1011,
  UnsoundPipeEdgeFilterUpgrade: 1012,
  ErrorHandlerFailed: 1013,
  AsyncErrorHandlerFailed: 1014
} as const;

export type StrongbusLogCode = typeof StrongbusLogCode[keyof typeof StrongbusLogCode];

export type StrongbusLogRecord = {
  code: StrongbusLogCode;
  message: string;
  context?: object;
};

/**
 * Destination for Strongbus diagnostic output (`options.logger`).
 *
 * Strongbus-authored lines are invoked as `level(record)`.
 * Discriminate on `record.code` ({@link StrongbusLogCode}); structured extras
 * live on optional `record.context`.
 */
export interface Logger {
  info(record: StrongbusLogRecord): void;
  warn(record: StrongbusLogRecord): void;
  error(record: StrongbusLogRecord): void;
  debug(record: StrongbusLogRecord): void;
}

export type LoggerProvider = Logger|(() => Logger);

/**
 * @internal
 * Default {@link Logger}: writes `record.message` (and `record.context` when
 * present) to `console`. Used when `options.logger` is omitted.
 */
export const defaultLogger: Logger = {
  info(record) {
    if(record.context === undefined) {
      console.info(record.message);
    } else {
      console.info(record.message, record.context);
    }
  },
  warn(record) {
    if(record.context === undefined) {
      console.warn(record.message);
    } else {
      console.warn(record.message, record.context);
    }
  },
  error(record) {
    if(record.context === undefined) {
      console.error(record.message);
    } else {
      console.error(record.message, record.context);
    }
  },
  debug(record) {
    if(record.context === undefined) {
      console.debug(record.message);
    } else {
      console.debug(record.message, record.context);
    }
  }
};
