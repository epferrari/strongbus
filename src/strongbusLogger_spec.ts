import {PIPE_EDGES, StrongbusLogger, StrongbusLogMessages} from './strongbusLogger';
import type {Logger} from './types/logger';
import type {MaterializedLeakDetection} from './types/materializedBusOptions';

interface TestEventMap {
  foo: number;
  bar: string;
}

describe('StrongbusLogger', () => {
  const name = 'TestBus';
  const thresholds = {info: 10, warn: 25, error: 60};
  const leakDetection: MaterializedLeakDetection = {enabled: true, thresholds, cadence: 'boundary', pipeEdges: false};
  let logger: jasmine.SpyObj<Logger>;

  function createLogger(overrides?: Partial<MaterializedLeakDetection>): StrongbusLogger<TestEventMap> {
    return new StrongbusLogger<TestEventMap>({
      name,
      provider: logger,
      leakDetection: {...leakDetection, ...overrides}
    });
  }

  beforeEach(() => {
    logger = jasmine.createSpyObj('logger', ['info', 'warn', 'error', 'debug']);
  });

  describe('#constructor', () => {
    it('logs through a provided Logger instance', () => {
      const subject = createLogger();
      subject.onDuplicateSubscription('on', 'foo', 'info');
      expect(logger.info).toHaveBeenCalledWith(
        StrongbusLogMessages.duplicateSubscription(name, 'on', 'foo')
      );
    });

    it('lazily resolves a LoggerProvider function exactly once', () => {
      let resolveCount = 0;
      const subject = new StrongbusLogger({
        name,
        provider: () => {
          resolveCount++;
          return logger;
        },
        leakDetection
      });

      expect(resolveCount).toBe(0);

      subject.onDuplicateSubscription('on', 'a', 'info');
      subject.onDuplicateSubscription('on', 'b', 'warn');
      subject.onDuplicateSubscription('on', 'c', 'error');

      expect(resolveCount).toBe(1);
      expect(logger.info).toHaveBeenCalledWith(
        StrongbusLogMessages.duplicateSubscription(name, 'on', 'a')
      );
      expect(logger.warn).toHaveBeenCalledWith(
        StrongbusLogMessages.duplicateSubscription(name, 'on', 'b')
      );
      expect(logger.error).toHaveBeenCalledWith(
        StrongbusLogMessages.duplicateSubscription(name, 'on', 'c')
      );
    });

    describe('given no provider', () => {
      beforeEach(() => {
        spyOn(console, 'info');
        spyOn(console, 'warn');
        spyOn(console, 'error');
        spyOn(console, 'debug');
      });

      it('logs record.message alone when context is undefined', () => {
        const subject = new StrongbusLogger<TestEventMap>({
          name,
          leakDetection
        });
        const entry = StrongbusLogMessages.duplicateSubscription(name, 'on', 'foo');

        subject.onDuplicateSubscription('on', 'foo', 'info');
        subject.onDuplicateSubscription('on', 'foo', 'warn');
        subject.onDuplicateSubscription('on', 'foo', 'debug');

        expect(console.info).toHaveBeenCalledWith(entry.message);
        expect(console.warn).toHaveBeenCalledWith(entry.message);
        expect(console.debug).toHaveBeenCalledWith(entry.message);
      });

      it('logs record.message and record.context when context is present', () => {
        const subject = new StrongbusLogger<TestEventMap>({
          name,
          leakDetection
        });
        const details = {
          errorHandlerError: new Error('boom'),
          originalEvent: 'foo',
          eventHandlerError: new Error('original')
        };
        const withContext = StrongbusLogMessages.errorHandlerFailed(details);

        subject.onErrorHandlerFailed(details);

        expect(console.error).toHaveBeenCalledWith(withContext.message, withContext.context);
      });
    });
  });

  describe('#onDuplicateSubscription', () => {
    it('forwards the built record at the requested level', () => {
      const subject = createLogger();
      subject.onDuplicateSubscription('on', 'i', 'info');
      subject.onDuplicateSubscription('on', 'w', 'warn');
      subject.onDuplicateSubscription('on', 'e', 'error');
      expect(logger.info).toHaveBeenCalledWith(
        StrongbusLogMessages.duplicateSubscription(name, 'on', 'i')
      );
      expect(logger.warn).toHaveBeenCalledWith(
        StrongbusLogMessages.duplicateSubscription(name, 'on', 'w')
      );
      expect(logger.error).toHaveBeenCalledWith(
        StrongbusLogMessages.duplicateSubscription(name, 'on', 'e')
      );
    });

    it('does not log when level is never', () => {
      createLogger().onDuplicateSubscription('on', 'foo', 'never');
      expect(logger.info).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.debug).not.toHaveBeenCalled();
    });
  });

  describe('#onErrorHandlerFailed / #onAsyncErrorHandlerFailed', () => {
    it('forwards the record with failure details on context', () => {
      const subject = createLogger();
      const details = {
        errorHandlerError: new Error('boom'),
        originalEvent: 'foo',
        eventHandlerError: new Error('original')
      };
      subject.onErrorHandlerFailed(details);
      subject.onAsyncErrorHandlerFailed(details);
      expect(logger.error).toHaveBeenCalledWith(
        StrongbusLogMessages.errorHandlerFailed(details)
      );
      expect(logger.error).toHaveBeenCalledWith(
        StrongbusLogMessages.asyncErrorHandlerFailed(details)
      );
    });
  });

  describe('#onAddListener', () => {
    describe('given cadence=\'boundary\'', () => {
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

    describe('given cadence=\'every\'', () => {
      it('logs info every time the count is above the info threshold', () => {
        createLogger({cadence: 'every'}).onAddListener('foo', thresholds.info + 1);
        expect(logger.info).toHaveBeenCalledWith(
          jasmine.objectContaining({message: jasmine.stringMatching(/listeners for "foo"/)})
        );
        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
      });

      it('logs warn every time the count is above the warn threshold', () => {
        createLogger({cadence: 'every'}).onAddListener('foo', thresholds.warn + 1);
        expect(logger.warn).toHaveBeenCalledWith(
          jasmine.objectContaining({message: jasmine.stringMatching(/Potential Memory Leak/)})
        );
        expect(logger.error).not.toHaveBeenCalled();
      });

      it('logs error every time the count is above the error threshold', () => {
        createLogger({cadence: 'every'}).onAddListener('foo', thresholds.error + 1);
        expect(logger.error).toHaveBeenCalledWith(
          jasmine.objectContaining({message: jasmine.stringMatching(/Potential Memory Leak/)})
        );
      });

      it('does not log when the count is at or below the info threshold', () => {
        createLogger({cadence: 'every'}).onAddListener('foo', thresholds.info);
        expect(logger.info).not.toHaveBeenCalled();
        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
      });
    });

    describe('given leak detection is disabled', () => {
      it('does not log at or above any threshold', () => {
        const subject = createLogger({enabled: false});
        subject.onAddListener('foo', thresholds.info);
        subject.onAddListener('foo', thresholds.error + 1);
        createLogger({enabled: false, cadence: 'every'}).onAddListener('foo', thresholds.error + 1);
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

    it('does not log when leak detection is disabled', () => {
      createLogger({enabled: false}).onListenerRemoved('foo', thresholds.info - 1);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe('#onPipeEdgeAdded / #onPipeEdgeRemoved', () => {
    describe('given pipeEdges=false', () => {
      it('does not log', () => {
        const subject = createLogger();
        subject.onPipeEdgeAdded(thresholds.info);
        subject.onPipeEdgeRemoved(thresholds.info - 1);
        expect(logger.info).not.toHaveBeenCalled();
      });
    });

    describe('given pipeEdges=true', () => {
      it('checks edges against the listener thresholds', () => {
        createLogger({pipeEdges: true}).onPipeEdgeAdded(thresholds.info);
        expect(logger.info).toHaveBeenCalledWith(
          StrongbusLogMessages.infoThresholdReached(name, thresholds.info, PIPE_EDGES)
        );
      });

      it('logs when edges drop below a listener threshold', () => {
        createLogger({pipeEdges: true}).onPipeEdgeRemoved(thresholds.info - 1);
        expect(logger.info).toHaveBeenCalledWith(
          StrongbusLogMessages.memoryPressureReducedBelowInfoThreshold(name, thresholds.info - 1, PIPE_EDGES)
        );
      });

      it('does not log when leak detection is disabled', () => {
        const subject = createLogger({pipeEdges: true, enabled: false});
        subject.onPipeEdgeAdded(thresholds.info);
        subject.onPipeEdgeRemoved(thresholds.info - 1);
        expect(logger.info).not.toHaveBeenCalled();
      });
    });

    describe('given pipeEdges={thresholds}', () => {
      it('checks edges against the pipe edge thresholds', () => {
        createLogger({pipeEdges: {thresholds: {info: 2}}}).onPipeEdgeAdded(2);
        expect(logger.info).toHaveBeenCalledWith(
          StrongbusLogMessages.infoThresholdReached(name, 2, PIPE_EDGES)
        );
      });

      it('falls back to the listener thresholds for unset keys', () => {
        const count = thresholds.warn + 1;
        createLogger({pipeEdges: {thresholds: {info: 2}}}).onPipeEdgeAdded(count);
        expect(logger.warn).toHaveBeenCalledWith(
          StrongbusLogMessages.warnThresholdExceeded(name, thresholds.warn, count, PIPE_EDGES)
        );
      });

      it('logs when edges drop below a pipe edge threshold', () => {
        createLogger({pipeEdges: {thresholds: {info: 2}}}).onPipeEdgeRemoved(1);
        expect(logger.info).toHaveBeenCalledWith(
          StrongbusLogMessages.memoryPressureReducedBelowInfoThreshold(name, 1, PIPE_EDGES)
        );
      });
    });
  });
});

describe('StrongbusLogMessages', () => {
  const name = 'TestBus';
  const thresholds = {info: 10, warn: 25, error: 60};

  it('#infoThresholdReached includes the name, threshold, and event', () => {
    const msg = StrongbusLogMessages.infoThresholdReached(name, thresholds.info, 'foo');
    expect(msg.message).toContain(name);
    expect(msg.message).toContain(String(thresholds.info));
    expect(msg.message).toContain('foo');
  });

  it('#warnThresholdReached includes the name, threshold, and event', () => {
    const msg = StrongbusLogMessages.warnThresholdReached(name, thresholds.warn, 'foo');
    expect(msg.message).toContain(name);
    expect(msg.message).toContain(String(thresholds.warn));
    expect(msg.message).toContain('foo');
  });

  it('#errorThresholdReached includes the name, threshold, and event', () => {
    const msg = StrongbusLogMessages.errorThresholdReached(name, thresholds.error, 'foo');
    expect(msg.message).toContain(name);
    expect(msg.message).toContain(String(thresholds.error));
    expect(msg.message).toContain('foo');
  });

  it('#infoThresholdExceeded includes the name, threshold, actual count, and event', () => {
    const msg = StrongbusLogMessages.infoThresholdExceeded(name, thresholds.info, 11, 'foo');
    expect(msg.message).toContain(name);
    expect(msg.message).toContain('11');
    expect(msg.message).toContain('foo');
  });

  it('#warnThresholdExceeded includes the name, threshold, actual count, and event', () => {
    const msg = StrongbusLogMessages.warnThresholdExceeded(name, thresholds.warn, 26, 'foo');
    expect(msg.message).toContain(name);
    expect(msg.message).toContain('26');
    expect(msg.message).toContain('foo');
  });

  it('#errorThresholdExceeded includes the name, threshold, actual count, and event', () => {
    const msg = StrongbusLogMessages.errorThresholdExceeded(name, thresholds.error, 61, 'foo');
    expect(msg.message).toContain(name);
    expect(msg.message).toContain('61');
    expect(msg.message).toContain('foo');
  });

  it('#memoryPressureReducedBelowErrorThreshold includes the name, count, and event', () => {
    const msg = StrongbusLogMessages.memoryPressureReducedBelowErrorThreshold(name, thresholds, 59, 'foo');
    expect(msg.message).toContain(name);
    expect(msg.message).toContain('59');
    expect(msg.message).toContain('foo');
  });

  it('#memoryPressureReducedBelowWarnThreshold includes the name, count, and event', () => {
    const msg = StrongbusLogMessages.memoryPressureReducedBelowWarnThreshold(name, thresholds, 24, 'foo');
    expect(msg.message).toContain(name);
    expect(msg.message).toContain('24');
    expect(msg.message).toContain('foo');
  });

  it('#memoryPressureReducedBelowInfoThreshold includes the name, count, and event', () => {
    const msg = StrongbusLogMessages.memoryPressureReducedBelowInfoThreshold(name, 9, 'foo');
    expect(msg.message).toContain(name);
    expect(msg.message).toContain('9');
    expect(msg.message).toContain('foo');
  });
});
