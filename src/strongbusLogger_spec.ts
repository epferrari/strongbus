import {StrongbusLogger, StrongbusLogMessages} from './strongbusLogger';
import type {Logger} from './types/logger';
import type {LogLevel, NoticeOptions} from './types/options';

interface TestEventMap {
  foo: number;
  bar: string;
}

describe('StrongbusLogger', () => {
  const name = 'TestBus';
  const thresholds = {info: 10, warn: 25, error: 60};
  const notices: Required<NoticeOptions> = {duplicateSubscription: 'warn'};
  let logger: jasmine.SpyObj<Logger>;

  function createLogger(overrides?: {
    verbose?: boolean;
    notices?: Required<NoticeOptions>;
  }): StrongbusLogger<TestEventMap> {
    return new StrongbusLogger<TestEventMap>({
      name,
      provider: logger,
      thresholds,
      notices,
      verbose: false,
      ...overrides
    });
  }

  beforeEach(() => {
    logger = jasmine.createSpyObj('logger', ['debug', 'info', 'warn', 'error']);
  });

  describe('#constructor', () => {
    it('logs through a provided Logger instance', () => {
      const subject = createLogger();
      subject.info('hello');
      expect(logger.info).toHaveBeenCalledWith('hello');
    });

    it('lazily resolves a LoggerProvider function exactly once', () => {
      let resolveCount = 0;
      const subject = new StrongbusLogger({
        name,
        provider: () => {
          resolveCount++;
          return logger;
        },
        thresholds,
        notices,
        verbose: false
      });

      expect(resolveCount).toBe(0);

      subject.info('a');
      subject.warn('b');
      subject.error('c');
      subject.debug('d');

      expect(resolveCount).toBe(1);
      expect(logger.info).toHaveBeenCalledWith('a');
      expect(logger.warn).toHaveBeenCalledWith('b');
      expect(logger.error).toHaveBeenCalledWith('c');
      expect(logger.debug).toHaveBeenCalledWith('d');
    });
  });

  describe('#info / #warn / #error / #debug', () => {
    it('forwards all arguments to the underlying logger', () => {
      const subject = createLogger();
      subject.debug('d', 0);
      subject.info('i', 1);
      subject.warn('w', 2);
      subject.error('e', 3);
      expect(logger.debug).toHaveBeenCalledWith('d', 0);
      expect(logger.info).toHaveBeenCalledWith('i', 1);
      expect(logger.warn).toHaveBeenCalledWith('w', 2);
      expect(logger.error).toHaveBeenCalledWith('e', 3);
    });
  });

  describe('#onDuplicateSubscription', () => {
    it('logs at the configured notice level', () => {
      (['error', 'warn', 'info', 'debug'] as Exclude<LogLevel, 'never'>[]).forEach((level) => {
        logger.debug.calls.reset();
        logger.info.calls.reset();
        logger.warn.calls.reset();
        logger.error.calls.reset();

        createLogger({notices: {duplicateSubscription: level}}).onDuplicateSubscription('foo', {
          existingIncognito: false,
          requestedIncognito: false
        });

        expect(logger[level]).toHaveBeenCalledWith(
          StrongbusLogMessages.duplicateSubscription(name, 'foo')
        );
      });
    });

    it('includes mode-mismatch verbiage when monitoring modes differ', () => {
      createLogger().onDuplicateSubscription('foo', {
        existingIncognito: false,
        requestedIncognito: true
      });

      expect(logger.warn).toHaveBeenCalledWith(
        StrongbusLogMessages.duplicateSubscription(name, 'foo', {
          existingIncognito: false,
          requestedIncognito: true
        })
      );
    });

    it('does not log when the notice level is never', () => {
      createLogger({notices: {duplicateSubscription: 'never'}}).onDuplicateSubscription('foo', {
        existingIncognito: false,
        requestedIncognito: false
      });

      expect(logger.debug).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe('#onAddListener', () => {
    describe('given verbose=false', () => {
      it('logs info when the info threshold is first reached', () => {
        createLogger().onAddListener('foo', thresholds.info);
        expect(logger.info).toHaveBeenCalledWith(
          StrongbusLogMessages.infoThresholdReached(name, thresholds.info, 'foo')
        );
      });

      it('logs info when the warn threshold is first reached', () => {
        createLogger().onAddListener('foo', thresholds.warn);
        expect(logger.info).toHaveBeenCalledWith(
          StrongbusLogMessages.warnThresholdReached(name, thresholds.warn, 'foo')
        );
      });

      it('logs info when the error threshold is first reached', () => {
        createLogger().onAddListener('foo', thresholds.error);
        expect(logger.info).toHaveBeenCalledWith(
          StrongbusLogMessages.errorThresholdReached(name, thresholds.error, 'foo')
        );
      });

      it('logs info when the info threshold is exceeded', () => {
        const count = thresholds.info + 1;
        createLogger().onAddListener('foo', count);
        expect(logger.info).toHaveBeenCalledWith(
          StrongbusLogMessages.infoThresholdExceeded(name, thresholds.info, count, 'foo')
        );
      });

      it('logs warn when the warn threshold is exceeded', () => {
        const count = thresholds.warn + 1;
        createLogger().onAddListener('foo', count);
        expect(logger.warn).toHaveBeenCalledWith(
          StrongbusLogMessages.warnThresholdExceeded(name, thresholds.warn, count, 'foo')
        );
      });

      it('logs error when the error threshold is exceeded', () => {
        const count = thresholds.error + 1;
        createLogger().onAddListener('foo', count);
        expect(logger.error).toHaveBeenCalledWith(
          StrongbusLogMessages.errorThresholdExceeded(name, thresholds.error, count, 'foo')
        );
      });

      it('does not log when the count is below the info threshold', () => {
        createLogger().onAddListener('foo', thresholds.info - 5);
        expect(logger.info).not.toHaveBeenCalled();
        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
      });
    });

    describe('given verbose=true', () => {
      it('logs info every time the count is above the info threshold', () => {
        createLogger({verbose: true}).onAddListener('foo', thresholds.info + 1);
        expect(logger.info).toHaveBeenCalledWith(jasmine.stringMatching(/listeners for "foo"/));
        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
      });

      it('logs warn every time the count is above the warn threshold', () => {
        createLogger({verbose: true}).onAddListener('foo', thresholds.warn + 1);
        expect(logger.warn).toHaveBeenCalledWith(jasmine.stringMatching(/Potential Memory Leak/));
        expect(logger.error).not.toHaveBeenCalled();
      });

      it('logs error every time the count is above the error threshold', () => {
        createLogger({verbose: true}).onAddListener('foo', thresholds.error + 1);
        expect(logger.error).toHaveBeenCalledWith(jasmine.stringMatching(/Potential Memory Leak/));
      });

      it('does not log when the count is at or below the info threshold', () => {
        createLogger({verbose: true}).onAddListener('foo', thresholds.info);
        expect(logger.info).not.toHaveBeenCalled();
        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
      });
    });
  });

  describe('#onListenerRemoved', () => {
    it('logs info when the count drops just below the error threshold', () => {
      const count = thresholds.error - 1;
      createLogger().onListenerRemoved('foo', count);
      expect(logger.info).toHaveBeenCalledWith(
        StrongbusLogMessages.memoryPressureReducedBelowErrorThreshold(name, thresholds, count, 'foo')
      );
    });

    it('logs info when the count drops just below the warn threshold', () => {
      const count = thresholds.warn - 1;
      createLogger().onListenerRemoved('foo', count);
      expect(logger.info).toHaveBeenCalledWith(
        StrongbusLogMessages.memoryPressureReducedBelowWarnThreshold(name, thresholds, count, 'foo')
      );
    });

    it('logs info when the count drops just below the info threshold', () => {
      const count = thresholds.info - 1;
      createLogger().onListenerRemoved('foo', count);
      expect(logger.info).toHaveBeenCalledWith(
        StrongbusLogMessages.memoryPressureReducedBelowInfoThreshold(name, count, 'foo')
      );
    });

    it('does not log when the count is not at a threshold boundary', () => {
      createLogger().onListenerRemoved('foo', 42);
      expect(logger.info).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });
  });
});

describe('StrongbusLogMessages', () => {
  const name = 'TestBus';
  const thresholds = {info: 10, warn: 25, error: 60};

  it('#infoThresholdReached includes the name, threshold, and event', () => {
    const msg = StrongbusLogMessages.infoThresholdReached(name, thresholds.info, 'foo');
    expect(msg).toContain(name);
    expect(msg).toContain(String(thresholds.info));
    expect(msg).toContain('foo');
  });

  it('#warnThresholdReached includes the name, threshold, and event', () => {
    const msg = StrongbusLogMessages.warnThresholdReached(name, thresholds.warn, 'foo');
    expect(msg).toContain(name);
    expect(msg).toContain(String(thresholds.warn));
    expect(msg).toContain('foo');
  });

  it('#errorThresholdReached includes the name, threshold, and event', () => {
    const msg = StrongbusLogMessages.errorThresholdReached(name, thresholds.error, 'foo');
    expect(msg).toContain(name);
    expect(msg).toContain(String(thresholds.error));
    expect(msg).toContain('foo');
  });

  it('#infoThresholdExceeded includes the name, threshold, actual count, and event', () => {
    const msg = StrongbusLogMessages.infoThresholdExceeded(name, thresholds.info, 11, 'foo');
    expect(msg).toContain(name);
    expect(msg).toContain('11');
    expect(msg).toContain('foo');
  });

  it('#warnThresholdExceeded includes the name, threshold, actual count, and event', () => {
    const msg = StrongbusLogMessages.warnThresholdExceeded(name, thresholds.warn, 26, 'foo');
    expect(msg).toContain(name);
    expect(msg).toContain('26');
    expect(msg).toContain('foo');
  });

  it('#errorThresholdExceeded includes the name, threshold, actual count, and event', () => {
    const msg = StrongbusLogMessages.errorThresholdExceeded(name, thresholds.error, 61, 'foo');
    expect(msg).toContain(name);
    expect(msg).toContain('61');
    expect(msg).toContain('foo');
  });

  it('#memoryPressureReducedBelowErrorThreshold includes the name, count, and event', () => {
    const msg = StrongbusLogMessages.memoryPressureReducedBelowErrorThreshold(name, thresholds, 59, 'foo');
    expect(msg).toContain(name);
    expect(msg).toContain('59');
    expect(msg).toContain('foo');
  });

  it('#memoryPressureReducedBelowWarnThreshold includes the name, count, and event', () => {
    const msg = StrongbusLogMessages.memoryPressureReducedBelowWarnThreshold(name, thresholds, 24, 'foo');
    expect(msg).toContain(name);
    expect(msg).toContain('24');
    expect(msg).toContain('foo');
  });

  it('#memoryPressureReducedBelowInfoThreshold includes the name, count, and event', () => {
    const msg = StrongbusLogMessages.memoryPressureReducedBelowInfoThreshold(name, 9, 'foo');
    expect(msg).toContain(name);
    expect(msg).toContain('9');
    expect(msg).toContain('foo');
  });

  it('#duplicateSubscription includes the name and event', () => {
    const msg = StrongbusLogMessages.duplicateSubscription(name, 'foo');
    expect(msg).toContain(name);
    expect(msg).toContain('foo');
    expect(msg).toContain('existing Subscription was returned');
    expect(msg).not.toContain('monitoring mode');
  });

  it('#duplicateSubscription includes mode-mismatch details when provided', () => {
    const msg = StrongbusLogMessages.duplicateSubscription(name, 'foo', {
      existingIncognito: true,
      requestedIncognito: false
    });
    expect(msg).toContain('from incognito to monitored');
    expect(msg).toContain('first registration wins');
  });
});
