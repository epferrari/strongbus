import {defaultLogger} from './logger';
import {StrongbusLogMessages} from '../strongbusLogger';

describe('defaultLogger', () => {
  const entry = StrongbusLogMessages.duplicateSubscription('TestBus', 'on', 'foo');
  const withContext = StrongbusLogMessages.errorHandlerFailed({
    errorHandlerError: new Error('boom'),
    originalEvent: 'foo',
    eventHandlerError: new Error('original')
  });

  beforeEach(() => {
    spyOn(console, 'info');
    spyOn(console, 'warn');
    spyOn(console, 'error');
    spyOn(console, 'debug');
  });

  it('logs record.message alone when context is undefined', () => {
    defaultLogger.info(entry);
    defaultLogger.warn(entry);
    defaultLogger.debug(entry);

    expect(console.info).toHaveBeenCalledWith(entry.message);
    expect(console.warn).toHaveBeenCalledWith(entry.message);
    expect(console.debug).toHaveBeenCalledWith(entry.message);
  });

  it('logs record.message and record.context when context is present', () => {
    defaultLogger.error(withContext);
    expect(console.error).toHaveBeenCalledWith(withContext.message, withContext.context);
  });
});
