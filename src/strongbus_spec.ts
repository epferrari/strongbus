
import {CancelablePromise, parallel, sleep, TimeoutExpiredError} from 'jaasync';

import * as Strongbus from './';
import type {Scanner} from './scanner';
import {StrongbusLogMessages} from './strongbusLogger';
import type {Logger} from './types/logger';
import {INTERNAL_PROMISE} from './utils/internalPromiseSymbol';
import type {EventMap} from './types/events';
import type {EventKeys, VoidEventKeys} from './types/utility';
import {over} from './utils/over';

type TestEventMap = {
  foo: string;
  bar: boolean;
  baz: number;
  quo: void;
};

const ALL_TEST_EVENTS: EventKeys<TestEventMap>[] = ['foo', 'bar', 'baz', 'quo'];

class DownstreamTestBus<T extends EventMap = TestEventMap> extends Strongbus.Bus<T> {
  private readonly emulateListenerCount: boolean = false;
  constructor(options: Strongbus.Options & {emulateListenerCount?: boolean}) {
    super(options);
    this.emulateListenerCount = options.emulateListenerCount;
  }

  public emit<E extends VoidEventKeys<T>>(event: E, payload?: null | undefined): boolean;
  public emit<E extends EventKeys<T>>(event: E, payload: T[E]): boolean;
  public emit<E extends EventKeys<T>>(event: E, payload?: T[E]): boolean {
    super.emit(event as any, payload as any);
    return this.emulateListenerCount;
  }

  protected acceptFromUpstream(event: any, payload?: any): boolean {
    super.acceptFromUpstream(event, payload);
    return this.emulateListenerCount;
  }
}

describe('Strongbus.Bus', () => {
  let bus: Strongbus.Bus<TestEventMap>;
  let singleEventHandler: jasmine.Spy;
  let eventSink: jasmine.Spy;

  beforeEach(() => {
    bus = new Strongbus.Bus<TestEventMap>();
    singleEventHandler = jasmine.createSpy('singleEventHandler');
    eventSink = jasmine.createSpy('eventSink');
  });

  describe('#constructor', () => {
    it('overloads the instance\'s internal emitter\'s emit method to invoke * listeners on every event raised', () => {
      bus.on('foo', singleEventHandler);
      bus.tap(eventSink);

      bus.emit('foo', 'eagle');
      expect(singleEventHandler).toHaveBeenCalledWith('eagle');
      expect(eventSink).toHaveBeenCalledWith({event: 'foo', payload: 'eagle'});
    });

    describe('thresholds', () => {
      it('sets default thresholds', () => {
        const options: Strongbus.Options = (bus as any).options;
        expect(options.thresholds.info).toEqual(100);
        expect(options.thresholds.warn).toEqual(500);
        expect(options.thresholds.error).toEqual(Infinity);
      });

      it('allows setting custom thresholds', () => {
        bus = new Strongbus.Bus<TestEventMap>({
          thresholds: {
            info: 7,
            warn: 14,
            error: 21
          }
        });

        const options: Strongbus.Options = (bus as any).options;
        expect(options.thresholds.info).toEqual(7);
        expect(options.thresholds.warn).toEqual(14);
        expect(options.thresholds.error).toEqual(21);
      });

      it('defaults coalesceDownstreamLifecycleEvents to true', () => {
        const options: Strongbus.Options = (bus as any).options;
        expect(options.coalesceDownstreamLifecycleEvents).toBeTrue();
      });
    });

    describe('given an unhandled event is raised', () => {
      describe('and given `options.onUnhandledEvent` is `\'throw\'`', () => {
        it('throws', () => {
          bus = new Strongbus.Bus({onUnhandledEvent: 'throw'});
          expect(() => bus.emit('foo', 'oops')).toThrowError(/unexpected message type 'foo'/);
        });
      });
      describe('and given `options.onUnhandledEvent` is a function', () => {
        it('invokes the callback with the event and payload', () => {
          const onUnhandledEvent = jasmine.createSpy('onUnhandledEvent');
          bus = new Strongbus.Bus({onUnhandledEvent});
          bus.emit('foo', 'oops');

          expect(onUnhandledEvent).toHaveBeenCalledWith('foo', 'oops');
        });
      });
      describe('and given `options.onUnhandledEvent` is `\'ignore\'` (default)', () => {
        it('does not throw', () => {
          expect(() => bus.emit('foo', 'oops')).not.toThrow();
        });
      });
    });
  });

  describe('Bus.configure', () => {
    let baseline: Strongbus.Options;

    beforeAll(() => {
      baseline = {...(new Strongbus.Bus() as any).options};
      baseline.thresholds = {...baseline.thresholds};
    });

    afterEach(() => {
      Strongbus.Bus.configure(baseline);
    });

    it('merges partial options onto static defaults for new instances', () => {
      Strongbus.Bus.configure({
        onUnhandledEvent: 'throw',
        verbose: false,
        thresholds: {warn: 12}
      });

      const configured = new Strongbus.Bus<TestEventMap>();
      const options: Strongbus.Options = (configured as any).options;

      expect(options.onUnhandledEvent).toBe('throw');
      expect(options.verbose).toBeFalse();
      expect(options.thresholds.info).toBe(100);
      expect(options.thresholds.warn).toBe(12);
      expect(options.thresholds.error).toBe(Infinity);
    });

    it('accumulates successive configure calls', () => {
      Strongbus.Bus.configure({onUnhandledEvent: 'throw'});
      Strongbus.Bus.configure({verbose: false});

      const options: Strongbus.Options = (new Strongbus.Bus() as any).options;
      expect(options.onUnhandledEvent).toBe('throw');
      expect(options.verbose).toBeFalse();
    });

    it('does not apply name via configure', () => {
      Strongbus.Bus.configure({name: 'App'} as Strongbus.Options);

      const options: Strongbus.Options = (new Strongbus.Bus() as any).options;
      expect(options.name).toBe('Anonymous');
    });
  });

  describe('listener logging thresholds', () => {

    describe('given options.logger is a Logger instance', () => {
      loggingSpecs(jasmine.createSpyObj('logger', ['info', 'warn', 'error', 'debug']));
    });

    describe('given options.logger is a LoggerProvider', () => {
      loggingSpecs(() => jasmine.createSpyObj('logger', ['info', 'warn', 'error', 'debug']));
    });

    function loggingSpecs(p: jasmine.SpyObj<Logger>|(() => jasmine.SpyObj<Logger>)): void {
      let provider: jasmine.SpyObj<Logger>|(() => jasmine.SpyObj<Logger>);
      let logger: jasmine.SpyObj<Logger>;

      function addListeners(numListenersToAdd: number): Strongbus.Subscription[] {
        const unsubs = new Array(numListenersToAdd);
        for(let i = 0; i < numListenersToAdd; i++) {
          unsubs[i] = bus.on('bar', () => true);
        }
        return unsubs;
      }

      function resetLogSpies() {
        logger.info.calls.reset();
        logger.warn.calls.reset();
        logger.error.calls.reset();
      }

      beforeEach(() => {
        if(typeof p === 'function') {
          // resolve once up front so assertions can use `logger` even when a test
          // emits no log lines (e.g. verbose mode at the exact info threshold).
          logger = p();
          provider = () => logger;
        } else {
          logger = provider = p;
        }
      });

      afterEach(() => {
        resetLogSpies();
      });

      describe('when adding a listener and listener count for an event exceeds a configured threshold', () => {
        describe('given `options.verbose=false` (default)', () => {
          it('logs only when a multiple of a threshold is reached', () => {
            bus = new Strongbus.Bus<TestEventMap>({
              name: 'Foo',
              logger: provider,
              thresholds: {
                info: 10,
                warn: 25,
                error: 60
              }
            });

            addListeners(10);
            // 10th triggers info about reaching threshold
            expect(logger.info).toHaveBeenCalledWith(
              StrongbusLogMessages.infoThresholdReached('Foo Bus', 10, 'bar')
            );
            expect(logger.warn).not.toHaveBeenCalled();
            expect(logger.error).not.toHaveBeenCalled();
            resetLogSpies();

            // 11th listener triggers info
            addListeners(1);
            expect(bus.getListenersFor('bar').size).toEqual(11);
            expect(logger.info).toHaveBeenCalledWith(
              StrongbusLogMessages.infoThresholdExceeded('Foo Bus', 10, 11, 'bar')
            );
            expect(logger.warn).not.toHaveBeenCalled();
            expect(logger.error).not.toHaveBeenCalled();
            resetLogSpies();

            // 12th listener triggers no logging
            addListeners(1);
            expect(bus.getListenersFor('bar').size).toEqual(12);
            expect(logger.info).not.toHaveBeenCalled();
            expect(logger.warn).not.toHaveBeenCalled();
            expect(logger.error).not.toHaveBeenCalled();

            addListeners(7);
            expect(bus.getListenersFor('bar').size).toEqual(19);
            expect(logger.info).not.toHaveBeenCalled();
            expect(logger.warn).not.toHaveBeenCalled();
            expect(logger.error).not.toHaveBeenCalled();

            // multiple of info threshold
            addListeners(1);
            expect(bus.getListenersFor('bar').size).toEqual(20);
            expect(logger.info).toHaveBeenCalledWith(
              StrongbusLogMessages.infoThresholdExceeded('Foo Bus', 10, 20, 'bar')
            );
            expect(logger.warn).not.toHaveBeenCalled();
            expect(logger.error).not.toHaveBeenCalled();
            resetLogSpies();

            addListeners(5);
            // 25th triggers info about reaching threshold
            expect(bus.getListenersFor('bar').size).toEqual(25);
            expect(logger.info).toHaveBeenCalledWith(
              StrongbusLogMessages.warnThresholdReached('Foo Bus', 25, 'bar')
            );
            expect(logger.warn).not.toHaveBeenCalled();
            expect(logger.error).not.toHaveBeenCalled();
            resetLogSpies();

            addListeners(1);
            // 26th triggers warning
            expect(bus.getListenersFor('bar').size).toEqual(26);
            expect(logger.info).not.toHaveBeenCalled();
            expect(logger.warn).toHaveBeenCalledWith(
              StrongbusLogMessages.warnThresholdExceeded('Foo Bus', 25, 26, 'bar')
            );
            expect(logger.error).not.toHaveBeenCalled();
            resetLogSpies();

            addListeners(4);
            // 30th triggers warning (as multiple of info threshold, but over warning limit)
            expect(bus.getListenersFor('bar').size).toEqual(30);
            expect(logger.info).not.toHaveBeenCalled();
            expect(logger.warn).toHaveBeenCalledWith(
              StrongbusLogMessages.warnThresholdExceeded('Foo Bus', 25, 30, 'bar')
            );
            expect(logger.error).not.toHaveBeenCalled();
            resetLogSpies();

            addListeners(20);
            // 40th and 50th trigger warnings
            expect(bus.getListenersFor('bar').size).toEqual(50);
            expect(logger.info).not.toHaveBeenCalled();
            expect(logger.warn).toHaveBeenCalledTimes(2);
            expect(logger.error).not.toHaveBeenCalled();
            resetLogSpies();

            addListeners(10);
            // 60th triggers info about reaching threshold
            expect(bus.getListenersFor('bar').size).toEqual(60);
            expect(logger.info).toHaveBeenCalledWith(
              StrongbusLogMessages.errorThresholdReached('Foo Bus', 60, 'bar')
            );
            expect(logger.warn).not.toHaveBeenCalled();
            expect(logger.error).not.toHaveBeenCalled();
            resetLogSpies();

            addListeners(1);
            // 61st triggers an error
            expect(bus.getListenersFor('bar').size).toEqual(61);
            expect(logger.info).not.toHaveBeenCalled();
            expect(logger.warn).not.toHaveBeenCalled();
            expect(logger.error).toHaveBeenCalledWith(
              StrongbusLogMessages.errorThresholdExceeded('Foo Bus', 60, 61, 'bar')
            );
            resetLogSpies();

            addListeners(9);
            // 70th triggers error (as a multiple of info threshold, but over error limit)
            expect(bus.getListenersFor('bar').size).toEqual(70);
            expect(logger.info).not.toHaveBeenCalled();
            expect(logger.warn).not.toHaveBeenCalled();
            expect(logger.error).toHaveBeenCalledWith(
              StrongbusLogMessages.errorThresholdExceeded('Foo Bus', 60, 70, 'bar')
            );
          });
        });

        describe('given `options.verbose=true`', () => {
          it('logs each time a listener is added', () => {
            bus = new Strongbus.Bus<TestEventMap>({
              logger: provider,
              verbose: true,
              thresholds: {
                info: 10,
                warn: 20,
                error: 30
              }
            });
            // no logging up to the threshold
            addListeners(10);
            expect(logger.info).withContext('at info threshold').not.toHaveBeenCalled();
            expect(logger.warn).withContext('at info threshold').not.toHaveBeenCalled();
            expect(logger.error).withContext('at info threshold').not.toHaveBeenCalled();

            // 11th listener triggers info
            addListeners(1);
            expect(bus.getListenersFor('bar').size).toEqual(11);
            expect(logger.info).withContext('crossed info threshold').toHaveBeenCalledTimes(1);
            expect(logger.warn).withContext('crossed info threshold').not.toHaveBeenCalled();
            expect(logger.error).withContext('crossed info threshold').not.toHaveBeenCalled();

            // 20th listener does not trigger warn
            addListeners(9);
            expect(logger.info).withContext('at warn threshold').toHaveBeenCalledTimes(10);
            expect(logger.warn).withContext('at warn threshold').not.toHaveBeenCalled();
            expect(logger.error).withContext('at warn threshold').not.toHaveBeenCalled();

            // 21st listener triggers warn
            addListeners(1);
            expect(logger.info).withContext('crossed warn threshold').toHaveBeenCalledTimes(10);
            expect(logger.warn).withContext('crossed warn threshold').toHaveBeenCalledTimes(1);
            expect(logger.error).withContext('crossed warn threshold').not.toHaveBeenCalled();

            // 30th listener does not trigger warn
            addListeners(9);
            expect(logger.info).withContext('at error threshold').toHaveBeenCalledTimes(10);
            expect(logger.warn).withContext('at error threshold').toHaveBeenCalledTimes(10);
            expect(logger.error).withContext('at error threshold').not.toHaveBeenCalled();

            // 31st listener triggers error
            addListeners(1);
            expect(logger.info).withContext('crossed error threshold').toHaveBeenCalledTimes(10);
            expect(logger.warn).withContext('crossed error threshold').toHaveBeenCalledTimes(10);
            expect(logger.error).withContext('crossed error threshold').toHaveBeenCalledTimes(1);
          });

          it('logs at the highest severity that passes the threshold', () => {
            bus = new Strongbus.Bus<TestEventMap>({
              logger: provider,
              verbose: true,
              thresholds: {
                // only warn-level specified, info is at default of 100
                warn: 20
              }
            });

            addListeners(21);
            expect(logger.info).not.toHaveBeenCalled();
            expect(logger.warn).toHaveBeenCalledTimes(1);
            expect(logger.error).not.toHaveBeenCalled();
          });
        });
      });

      describe('when a listener is removed', () => {
        describe('and the listener count for an event drops below a threshold', () => {
          it('logs an info message', () => {
            bus = new Strongbus.Bus<TestEventMap>({
              logger: provider,
              thresholds: {
                info: 10,
                warn: 25,
                error: 60
              }
            });

            const unsubs = addListeners(70);
            logger.info.calls.reset();

            over(unsubs.splice(60))();
            expect(bus.getListenersFor('bar').size).toEqual(60);
            expect(logger.info).not.toHaveBeenCalled();

            over(unsubs.splice(59))();
            expect(bus.getListenersFor('bar').size).toEqual(59);
            // logs crossing the error threshold
            expect(logger.info).toHaveBeenCalledTimes(1);

            over(unsubs.splice(25))();
            expect(bus.getListenersFor('bar').size).toEqual(25);
            expect(logger.info).toHaveBeenCalledTimes(1);

            over(unsubs.splice(24))();
            expect(bus.getListenersFor('bar').size).toEqual(24);
            // logs crossing the warning threshold
            expect(logger.info).toHaveBeenCalledTimes(2);

            over(unsubs.splice(10))();
            expect(bus.getListenersFor('bar').size).toEqual(10);
            expect(logger.info).toHaveBeenCalledTimes(2);

            over(unsubs.splice(9))();
            expect(bus.getListenersFor('bar').size).toEqual(9);
            // logs crossing the info threshold
            expect(logger.info).toHaveBeenCalledTimes(3);

            over(unsubs)();
            expect(bus.getListenersFor('bar').size).toBe(0);
            expect(logger.info).toHaveBeenCalledTimes(3);
          });
        });
      });
    }

  });

  describe('#emit', () => {
    describe('given an event is mapped to a void payload', () => {
      it('can be called with only the event argument', () => {
        bus.emit('quo'); // not passing second arg, no type error;
      });

      it('can be called with a second argument of `null`', () => {
        bus.emit('quo', null); // no type error;
      });

      it('can be called with a second argument of `undefined`', () => {
        bus.emit('quo', undefined); // no type error;
      });

      it('can be called with a second argument of `void(0)`', () => {
        bus.emit('quo', void(0)); // no type error;
      });

      it('cannot be called with any other second argument', () => {
        // uncomment following lines and observe type error
        // bus.emit('quo', false); // not passing second arg, no type error;
        // bus.emit('quo', 0); // not passing second arg, no type error;
      });
    });

    describe('given an event is mapped to a non-void payload', () => {
      it('must be called with a payload argument', () => {
        bus.emit('foo', 'eagle'); // attempt to remove the second arg, and observe a type error
      });
    });

    describe('return value', () => {
      it('returns false when the event has no listeners', () => {
        expect(bus.emit('foo', 'eagle')).toBeFalse();
      });

      it('returns true when an own listener handles the event', () => {
        bus.on('foo', singleEventHandler);
        expect(bus.emit('foo', 'eagle')).toBeTrue();
      });

      it('returns true when only a wildcard (tap) listener handles the event', () => {
        bus.tap(eventSink);
        expect(bus.emit('foo', 'eagle')).toBeTrue();
      });

      it('returns true when only a downstream handles the event', () => {
        const downstream = new Strongbus.Bus<TestEventMap>();
        downstream.on('foo', singleEventHandler);
        bus.pipe(downstream);

        expect(bus.emit('foo', 'eagle')).toBeTrue();
        expect(singleEventHandler).toHaveBeenCalledWith('eagle');
      });

      it('returns false when a downstream exists but has no listener for the event', () => {
        const downstream = new Strongbus.Bus<TestEventMap>();
        downstream.on('bar', singleEventHandler);
        bus.pipe(downstream);

        expect(bus.emit('foo', 'eagle')).toBeFalse();
      });
    });
  });

  describe('#on', () => {
    it('subscribes handler to an event as a key of its typemap', () => {
      const handleFoo = jasmine.createSpy('handleFoo') as (fooPayload: string) => void;
      bus.on('foo', handleFoo);

      bus.emit('foo', 'elephant');

      expect(handleFoo).toHaveBeenCalledWith('elephant');
    });

    it('does not invoke subscribers added during callbacks', async () => {
      const barSpy = jasmine.createSpy();
      bus.on('bar', () => {
        bus.on('bar', barSpy);
      });
      bus.emit('bar', true);

      expect(barSpy).not.toHaveBeenCalled();
    });

    it('does not get events once the subscription has been released', () => {
      const barSpy = jasmine.createSpy();
      const sub = bus.on('bar', barSpy);

      sub();
      bus.emit('bar', true);
      expect(barSpy).not.toHaveBeenCalled();
    });

    it('returns the same Subscription for a duplicate on with the same handler', () => {
      const handleFoo = jasmine.createSpy('handleFoo') as (fooPayload: string) => void;
      const onWillAdd = jasmine.createSpy('willAddListener');
      const onDidAdd = jasmine.createSpy('didAddListener');
      const onWillRemove = jasmine.createSpy('willRemoveListener');
      const onDidRemove = jasmine.createSpy('didRemoveListener');
      const onWillIdle = jasmine.createSpy('willIdle');
      const onIdle = jasmine.createSpy('idle');
      bus.hook('willAddListener', onWillAdd);
      bus.hook('didAddListener', onDidAdd);
      bus.hook('willRemoveListener', onWillRemove);
      bus.hook('didRemoveListener', onDidRemove);
      bus.hook('willIdle', onWillIdle);
      bus.hook('idle', onIdle);

      const sub1 = bus.on('foo', handleFoo);
      expect(onWillAdd).toHaveBeenCalledTimes(1);
      expect(onDidAdd).toHaveBeenCalledTimes(1);

      const sub2 = bus.on('foo', handleFoo);
      expect(sub1).toBe(sub2);
      expect(onWillAdd).toHaveBeenCalledTimes(1);
      expect(onDidAdd).toHaveBeenCalledTimes(1);

      bus.emit('foo', 'elephant');
      expect(handleFoo).toHaveBeenCalledTimes(1);

      sub1();
      expect(bus.hasListeners()).toBeFalse();
      expect(handleFoo).toHaveBeenCalledTimes(1);
      expect(onWillRemove).toHaveBeenCalledTimes(1);
      expect(onDidRemove).toHaveBeenCalledTimes(1);
      expect(onWillIdle).toHaveBeenCalledTimes(1);
      expect(onIdle).toHaveBeenCalledTimes(1);

      onWillRemove.calls.reset();
      onDidRemove.calls.reset();
      onWillIdle.calls.reset();
      onIdle.calls.reset();

      sub2();
      expect(onWillRemove).not.toHaveBeenCalled();
      expect(onDidRemove).not.toHaveBeenCalled();
      expect(onWillIdle).not.toHaveBeenCalled();
      expect(onIdle).not.toHaveBeenCalled();
    });

    describe('returns a Subscription', () => {
      it('which can be disposed by direct invocation', () => {
        const unsub = bus.on('foo', () => { return; });
        expect(bus.hasListeners()).toBeTruthy();

        unsub();
        expect(bus.hasListeners()).toBeFalsy();
      });

      it('which can be disposed by calling .unsubscribe on the Subscription reference', () => {
        const unsub2 = bus.on('foo', () => { return; });
        expect(bus.hasListeners()).toBeTruthy();

        unsub2.unsubscribe();
        expect(bus.hasListeners()).toBeFalsy();
      });
    });
  });

  describe('#off', () => {
    it('removes a handler previously registered with on', () => {
      const handleFoo = jasmine.createSpy('handleFoo') as (fooPayload: string) => void;
      bus.on('foo', handleFoo);

      bus.off('foo', handleFoo);
      bus.emit('foo', 'elephant');

      expect(handleFoo).not.toHaveBeenCalled();
      expect(bus.hasListeners()).toBeFalsy();
    });

    it('is a no-op when the handler is not registered', () => {
      const handleFoo = jasmine.createSpy('handleFoo') as (fooPayload: string) => void;

      expect(() => bus.off('foo', handleFoo)).not.toThrow();
      expect(bus.hasListeners()).toBeFalsy();
    });

    it('is idempotent', () => {
      const handleFoo = jasmine.createSpy('handleFoo') as (fooPayload: string) => void;
      bus.on('foo', handleFoo);

      bus.off('foo', handleFoo);
      expect(() => bus.off('foo', handleFoo)).not.toThrow();
      expect(bus.hasListeners()).toBeFalsy();
    });

    it('makes a previously returned Subscription a no-op', () => {
      const handleFoo = jasmine.createSpy('handleFoo') as (fooPayload: string) => void;
      const sub = bus.on('foo', handleFoo);

      bus.off('foo', handleFoo);
      expect(() => sub()).not.toThrow();
      expect(bus.hasListeners()).toBeFalsy();
    });

    it('does not remove other handlers on the same event', () => {
      const handleA = jasmine.createSpy('handleA') as (fooPayload: string) => void;
      const handleB = jasmine.createSpy('handleB') as (fooPayload: string) => void;
      bus.on('foo', handleA);
      bus.on('foo', handleB);

      bus.off('foo', handleA);
      bus.emit('foo', 'elephant');

      expect(handleA).not.toHaveBeenCalled();
      expect(handleB).toHaveBeenCalledWith('elephant');
    });

    it('does not remove the same handler registered on a different event', () => {
      const handle = jasmine.createSpy('handle');
      bus.on('foo', handle as (fooPayload: string) => void);
      bus.on('bar', handle as (barPayload: boolean) => void);

      bus.off('foo', handle as (fooPayload: string) => void);
      bus.emit('foo', 'elephant');
      bus.emit('bar', true);

      expect(handle).toHaveBeenCalledTimes(1);
      expect(handle).toHaveBeenCalledWith(true);
    });

    it('returns void', () => {
      const handleFoo = jasmine.createSpy('handleFoo') as (fooPayload: string) => void;
      bus.on('foo', handleFoo);

      expect(bus.off('foo', handleFoo)).toBeUndefined();
    });

    it('raises the same remove lifecycle hooks as unsubscribing', () => {
      const handleFoo = jasmine.createSpy('handleFoo') as (fooPayload: string) => void;
      bus.on('foo', handleFoo);

      const order: string[] = [];
      bus.hook('willRemoveListener', (event) => order.push(`willRemove:${event}`));
      bus.hook('didRemoveListener', (event) => order.push(`didRemove:${event}`));
      bus.hook('willIdle', () => order.push('willIdle'));
      bus.hook('idle', () => order.push('idle'));

      bus.off('foo', handleFoo);

      expect(order).toEqual([
        'willIdle',
        'willRemove:foo',
        'didRemove:foo',
        'idle'
      ]);
    });
  });

  describe('duplicateSubscriptionStrategy', () => {
    it('defaults to collapse + warn', () => {
      const options: Strongbus.Options = (bus as any).options;
      expect(options.duplicateSubscriptionStrategy).toEqual({
        observability: 'collapse',
        invocation: 'collapse',
        disposal: 'collapse',
        logLevel: 'warn'
      });
    });

    it('exposes EventEmitter, EventTarget, and SharedHandler presets', () => {
      expect(Strongbus.DuplicateSubscriptionStrategy.EventEmitter).toEqual({
        observability: 'stack',
        invocation: 'stack',
        disposal: 'stack',
        logLevel: 'never'
      });
      expect(Strongbus.DuplicateSubscriptionStrategy.EventTarget).toEqual({
        observability: 'collapse',
        invocation: 'collapse',
        disposal: 'collapse',
        logLevel: 'never'
      });
      expect(Strongbus.DuplicateSubscriptionStrategy.SharedHandler).toEqual({
        observability: 'stack',
        invocation: 'collapse',
        disposal: 'stack',
        logLevel: 'never'
      });
    });

    describe('default collapse + warn', () => {
      it('warns on duplicate on and keeps collapsed behavior', () => {
        const warn = jasmine.createSpy('warn');
        bus = new Strongbus.Bus<TestEventMap>({
          logger: {info: () => undefined, warn, error: () => undefined, debug: () => undefined}
        });
        const handleFoo = jasmine.createSpy('handleFoo') as (fooPayload: string) => void;

        const sub1 = bus.on('foo', handleFoo);
        const sub2 = bus.on('foo', handleFoo);

        expect(sub1).toBe(sub2);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.calls.mostRecent().args[0].message).toContain('duplicate on');

        bus.emit('foo', 'x');
        expect(handleFoo).toHaveBeenCalledTimes(1);
        expect(bus.getListenerCountFor('foo')).toBe(1);
      });
    });

    describe('SharedHandler preset', () => {
      beforeEach(() => {
        bus = new Strongbus.Bus<TestEventMap>({
          duplicateSubscriptionStrategy: Strongbus.DuplicateSubscriptionStrategy.SharedHandler
        });
      });

      it('invokes once while allowing independent dispose', () => {
        const handleFoo = jasmine.createSpy('handleFoo') as (fooPayload: string) => void;
        const a = bus.on('foo', handleFoo);
        const b = bus.on('foo', handleFoo);

        expect(a).not.toBe(b);
        expect(bus.getListenerCountFor('foo')).toBe(2);

        bus.emit('foo', 'x');
        expect(handleFoo).toHaveBeenCalledTimes(1);

        a();
        expect(bus.getListenerCountFor('foo')).toBe(1);
        bus.emit('foo', 'y');
        expect(handleFoo).toHaveBeenCalledTimes(2);

        b();
        expect(bus.hasListeners()).toBeFalse();
      });

      it('off pops the oldest SharedHandler frame (head of stack)', () => {
        const handleFoo = jasmine.createSpy('handleFoo') as (fooPayload: string) => void;
        const first = bus.on('foo', handleFoo);
        const second = bus.on('foo', handleFoo);

        bus.off('foo', handleFoo);
        expect(bus.getListenerCountFor('foo')).toBe(1);

        first();
        expect(bus.getListenerCountFor('foo')).toBe(1);
        bus.emit('foo', 'z');
        expect(handleFoo).toHaveBeenCalledTimes(1);

        second();
        expect(bus.hasListeners()).toBeFalse();
      });
    });

    describe('EventEmitter preset', () => {
      beforeEach(() => {
        bus = new Strongbus.Bus<TestEventMap>({
          duplicateSubscriptionStrategy: Strongbus.DuplicateSubscriptionStrategy.EventEmitter
        });
      });

      it('stacks observability, invocation, and disposal', () => {
        const handleFoo = jasmine.createSpy('handleFoo') as (fooPayload: string) => void;
        const a = bus.on('foo', handleFoo);
        const b = bus.on('foo', handleFoo);

        expect(a).not.toBe(b);
        expect(bus.getListenerCountFor('foo')).toBe(2);

        bus.emit('foo', 'x');
        expect(handleFoo).toHaveBeenCalledTimes(2);

        a();
        expect(bus.getListenerCountFor('foo')).toBe(1);
        bus.emit('foo', 'y');
        expect(handleFoo).toHaveBeenCalledTimes(3);
      });

      it('off pops the oldest stacked registration (head of stack)', () => {
        const handleFoo = jasmine.createSpy('handleFoo') as (fooPayload: string) => void;
        const first = bus.on('foo', handleFoo);
        const second = bus.on('foo', handleFoo);

        bus.off('foo', handleFoo);
        expect(bus.getListenerCountFor('foo')).toBe(1);

        first();
        expect(bus.getListenerCountFor('foo')).toBe(1);
        bus.emit('foo', 'y');
        expect(handleFoo).toHaveBeenCalledTimes(1);

        second();
        expect(bus.hasListeners()).toBeFalse();
      });
    });

    describe('EventTarget preset', () => {
      beforeEach(() => {
        bus = new Strongbus.Bus<TestEventMap>({
          duplicateSubscriptionStrategy: Strongbus.DuplicateSubscriptionStrategy.EventTarget
        });
      });

      it('collapses duplicate on without logging', () => {
        const warn = jasmine.createSpy('warn');
        const info = jasmine.createSpy('info');
        const error = jasmine.createSpy('error');
        const debug = jasmine.createSpy('debug');
        bus = new Strongbus.Bus<TestEventMap>({
          duplicateSubscriptionStrategy: Strongbus.DuplicateSubscriptionStrategy.EventTarget,
          logger: {info, warn, error, debug}
        });
        const handleFoo = jasmine.createSpy('handleFoo') as (fooPayload: string) => void;

        const sub1 = bus.on('foo', handleFoo);
        const sub2 = bus.on('foo', handleFoo);

        expect(sub1).toBe(sub2);
        expect(warn).not.toHaveBeenCalled();
        expect(info).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
        expect(debug).not.toHaveBeenCalled();
        expect(bus.getListenerCountFor('foo')).toBe(1);

        bus.emit('foo', 'x');
        expect(handleFoo).toHaveBeenCalledTimes(1);

        sub1();
        expect(bus.hasListeners()).toBeFalse();
        sub2();
        expect(bus.hasListeners()).toBeFalse();
      });

      it('off clears the collapsed registration', () => {
        const handleFoo = jasmine.createSpy('handleFoo') as (fooPayload: string) => void;
        bus.on('foo', handleFoo);
        bus.on('foo', handleFoo);

        bus.off('foo', handleFoo);
        expect(bus.hasListeners()).toBeFalse();
        bus.emit('foo', 'x');
        expect(handleFoo).not.toHaveBeenCalled();
      });
    });

    describe('once kind isolation', () => {
      it('does not clear on when disposing once for the same handler', () => {
        bus = new Strongbus.Bus<TestEventMap>({
          duplicateSubscriptionStrategy: Strongbus.DuplicateSubscriptionStrategy.EventTarget
        });
        const handleFoo = jasmine.createSpy('handleFoo') as (fooPayload: string) => void;
        bus.on('foo', handleFoo);
        const onceSub = bus.once('foo', handleFoo);

        onceSub();
        bus.emit('foo', 'still-on');
        expect(handleFoo).toHaveBeenCalledWith('still-on');
      });

      it('does not clear once when off removes on for the same handler', () => {
        bus = new Strongbus.Bus<TestEventMap>({
          duplicateSubscriptionStrategy: Strongbus.DuplicateSubscriptionStrategy.EventTarget
        });
        const handleFoo = jasmine.createSpy('handleFoo') as (fooPayload: string) => void;
        bus.on('foo', handleFoo);
        bus.once('foo', handleFoo);

        bus.off('foo', handleFoo);
        bus.emit('foo', 'once-only');
        expect(handleFoo).toHaveBeenCalledTimes(1);
        expect(handleFoo).toHaveBeenCalledWith('once-only');
        expect(bus.hasListeners()).toBeFalse();
      });

      it('honors invocation stack across duplicate once registrations', () => {
        bus = new Strongbus.Bus<TestEventMap>({
          duplicateSubscriptionStrategy: {
            observability: 'collapse',
            invocation: 'stack',
            disposal: 'collapse',
            logLevel: 'never'
          }
        });
        const handleFoo = jasmine.createSpy('handleFoo') as (fooPayload: string) => void;
        const a = bus.once('foo', handleFoo);
        const b = bus.once('foo', handleFoo);
        expect(a).not.toBe(b);

        bus.emit('foo', 'x');
        expect(handleFoo).toHaveBeenCalledTimes(2);
        expect(bus.hasListeners()).toBeFalse();
      });
    });

    describe('any event-set identity', () => {
      it('treats order-independent event sets as the same listenable', () => {
        bus = new Strongbus.Bus<TestEventMap>({
          duplicateSubscriptionStrategy: Strongbus.DuplicateSubscriptionStrategy.EventTarget
        });
        const sink = jasmine.createSpy('sink');
        const a = bus.any(['foo', 'bar'], sink);
        const b = bus.any(['bar', 'foo'], sink);
        expect(a).toBe(b);

        bus.emit('foo', 'x');
        expect(sink).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('unsubscribe queue', () => {
    let onWillRemoveListener: jasmine.Spy;
    let onRemoveListener: jasmine.Spy;
    let onWillIdle: jasmine.Spy;
    let onIdle: jasmine.Spy;

    beforeEach(() => {
      bus.hook('willRemoveListener', onWillRemoveListener = jasmine.createSpy('onWillRemoveListener'));
      bus.hook('didRemoveListener', onRemoveListener = jasmine.createSpy('onRemoveListener'));
      bus.hook('willIdle', onWillIdle = jasmine.createSpy('onWillIdle'));
      bus.hook('idle', onIdle = jasmine.createSpy('onIdle'));
    });

    it('handles unsubscribes fired from hooks', () => {
      const sub1 = bus.on('foo', () => null);
      const sub2 = bus.on('foo', () => null);
      bus.hook('willRemoveListener', () => sub2());

      sub1();
      expect(onWillIdle).toHaveBeenCalledTimes(1);
      expect(onIdle).toHaveBeenCalledTimes(1);
    });

    it('defers a nested unsubscribe until the current removal finishes', () => {
      const order: string[] = [];
      const sub1 = bus.on('foo', () => null);
      const sub2 = bus.on('bar', () => null);
      let nested = false;

      bus.hook('willRemoveListener', (event) => {
        order.push(`willRemove:${event}`);
        if(!nested && event === 'foo') {
          nested = true;
          order.push('queue-sub2');
          sub2();
          order.push('after-queue-sub2');
        }
      });
      bus.hook('didRemoveListener', (event) => order.push(`didRemove:${event}`));

      sub1();

      // nested sub2() returns before bar's willRemove — queued, not re-entrant
      expect(order).toEqual([
        'willRemove:foo',
        'queue-sub2',
        'after-queue-sub2',
        'didRemove:foo',
        'willRemove:bar',
        'didRemove:bar'
      ]);
      expect(bus.hasListeners()).toBeFalse();
      expect(onWillIdle).toHaveBeenCalledTimes(1);
      expect(onIdle).toHaveBeenCalledTimes(1);
    });

    it('defers unsubscribes triggered from didRemoveListener', () => {
      const order: string[] = [];
      const sub1 = bus.on('foo', () => null);
      const sub2 = bus.on('bar', () => null);
      let nested = false;

      bus.hook('willRemoveListener', (event) => order.push(`willRemove:${event}`));
      bus.hook('didRemoveListener', (event) => {
        order.push(`didRemove:${event}`);
        if(!nested && event === 'foo') {
          nested = true;
          order.push('queue-sub2');
          sub2();
          order.push('after-queue-sub2');
        }
      });

      sub1();

      expect(order).toEqual([
        'willRemove:foo',
        'didRemove:foo',
        'queue-sub2',
        'after-queue-sub2',
        'willRemove:bar',
        'didRemove:bar'
      ]);
      expect(bus.hasListeners()).toBeFalse();
    });

    it('processes a chain of nested unsubscribes in FIFO order', () => {
      const order: string[] = [];
      const sub1 = bus.on('foo', () => null);
      const sub2 = bus.on('bar', () => null);
      const sub3 = bus.on('baz', () => null);

      bus.hook('willRemoveListener', (event) => {
        order.push(`willRemove:${event}`);
        if(event === 'foo') {
          sub2();
        } else if(event === 'bar') {
          sub3();
        }
      });
      bus.hook('didRemoveListener', (event) => order.push(`didRemove:${event}`));

      sub1();

      expect(order).toEqual([
        'willRemove:foo',
        'didRemove:foo',
        'willRemove:bar',
        'didRemove:bar',
        'willRemove:baz',
        'didRemove:baz'
      ]);
      expect(bus.hasListeners()).toBeFalse();
      expect(onWillIdle).toHaveBeenCalledTimes(1);
      expect(onIdle).toHaveBeenCalledTimes(1);
    });

    it('treats a duplicate dispose of an already-queued subscription as a no-op', () => {
      const sub1 = bus.on('foo', () => null);
      const sub2 = bus.on('bar', () => null);

      bus.hook('willRemoveListener', (event) => {
        if(event === 'foo') {
          sub2();
          sub2();
        }
      });

      sub1();

      expect(bus.hasListeners()).toBeFalse();
      expect(onWillRemoveListener).toHaveBeenCalledTimes(2);
      expect(onRemoveListener).toHaveBeenCalledTimes(2);
      expect(onWillIdle).toHaveBeenCalledTimes(1);
      expect(onIdle).toHaveBeenCalledTimes(1);
    });

    it('removes handlers so subsequent emits do not invoke them', () => {
      const handleFoo = jasmine.createSpy('handleFoo');
      const handleBar = jasmine.createSpy('handleBar');
      const sub1 = bus.on('foo', handleFoo);
      const sub2 = bus.on('bar', handleBar);
      bus.hook('willRemoveListener', (event) => {
        if(event === 'foo') {
          sub2();
        }
      });

      sub1();
      bus.emit('foo', 'x');
      bus.emit('bar', true);

      expect(handleFoo).not.toHaveBeenCalled();
      expect(handleBar).not.toHaveBeenCalled();
    });
  });

  describe('#once', () => {
    it('subscribes handler to an event and unsubscribes after the first invocation', () => {
      const handleFoo = jasmine.createSpy('handleFoo') as (fooPayload: string) => void;
      bus.once('foo', handleFoo);

      bus.emit('foo', 'elephant');
      expect(handleFoo).toHaveBeenCalledWith('elephant');

      bus.emit('foo', 'giraffe');
      expect(handleFoo).toHaveBeenCalledTimes(1);
    });

    it('does not invoke the handler if unsubscribed before the event is raised', () => {
      const handleFoo = jasmine.createSpy('handleFoo') as (fooPayload: string) => void;
      const sub = bus.once('foo', handleFoo);

      sub();
      bus.emit('foo', 'elephant');
      expect(handleFoo).not.toHaveBeenCalled();
    });

    it('does not invoke subscribers added during callbacks', () => {
      const barSpy = jasmine.createSpy();
      bus.once('bar', () => {
        bus.once('bar', barSpy);
      });
      bus.emit('bar', true);

      expect(barSpy).not.toHaveBeenCalled();
    });
  });

  describe('#any', () => {
    describe('given a list of events to listen on', () => {
      describe('given one of the events in the list is raised', () => {
        it('invokes the supplied handler with event and payload', () => {
          bus.any(['foo', 'bar'], eventSink);
          bus.emit('foo', 'flamingo');
          expect(eventSink).toHaveBeenCalledTimes(1);
          expect(eventSink.calls.mostRecent().args).toEqual(['foo', 'flamingo']);
          bus.emit('bar', true);
          expect(eventSink).toHaveBeenCalledTimes(2);
          expect(eventSink.calls.mostRecent().args).toEqual(['bar', true]);
        });
      });

      describe('given an event not in the list is raised', () => {
        it('does not invoke the handler', () => {
          bus.emit('baz', 5);
          expect(eventSink).toHaveBeenCalledTimes(0);
        });
      });

      it('returns a Subscription', () => {
        const onUnhandledEvent = jasmine.createSpy('onUnhandledEvent');
        bus = new Strongbus.Bus({onUnhandledEvent});

        const unsubFoo = bus.any(['foo', 'bar'], eventSink);
        bus.emit('foo', null);
        expect(eventSink).toHaveBeenCalledTimes(1);
        expect(onUnhandledEvent).not.toHaveBeenCalled();
        eventSink.calls.reset();

        unsubFoo();
        bus.emit('bar', null);
        expect(eventSink).not.toHaveBeenCalled();
        expect(onUnhandledEvent).toHaveBeenCalledWith('bar', null);
        onUnhandledEvent.calls.reset();

        bus.emit('baz', null);
        expect(eventSink).not.toHaveBeenCalled();
        expect(onUnhandledEvent).toHaveBeenCalledWith('baz', null);
      });
    });
  });

  describe('event delegation', () => {
    let bus2: DownstreamTestBus;
    let bus3: DownstreamTestBus;

    describe('#tap', () => {
      describe('given any event is emitted', () => {
        it('invokes the handler with a single {event, payload} message', () => {
          bus.on('foo', singleEventHandler);
          bus.tap(eventSink);

          bus.emit('foo', 'cat');
          expect(singleEventHandler).toHaveBeenCalledWith('cat');
          expect(eventSink).toHaveBeenCalledTimes(1);
          expect(eventSink).toHaveBeenCalledWith({event: 'foo', payload: 'cat'});
        });
      });

      it('delivers each raised event as its own correlated message', () => {
        const messages: {event: EventKeys<TestEventMap>; payload: unknown}[] = [];
        bus.tap((msg: Strongbus.PipedMessage<TestEventMap>) => { messages.push(msg); });

        bus.emit('foo', 'cat');
        bus.emit('baz', 7);

        expect(messages).toEqual([
          {event: 'foo', payload: 'cat'},
          {event: 'baz', payload: 7}
        ]);
      });

      describe('and given an event is raised', () => {
        it('invokes the supplied handler with a correlated {event, payload} message', () => {
          bus.tap(eventSink);
          bus.emit('foo', 'raccoon');
          expect(eventSink).toHaveBeenCalledTimes(1);
          expect(eventSink).toHaveBeenCalledWith({event: 'foo', payload: 'raccoon'});
          bus.emit('foo', 'squirrel');
          expect(eventSink).toHaveBeenCalledTimes(2);
          expect(eventSink).toHaveBeenCalledWith({event: 'foo', payload: 'squirrel'});
          bus.emit('baz', 5);
          expect(eventSink).toHaveBeenCalledTimes(3);
          expect(eventSink).toHaveBeenCalledWith({event: 'baz', payload: 5});
        });
      });

      it('returns a Subscription that stops delivery when disposed', () => {
        const sub = bus.tap(eventSink);
        bus.emit('foo', 'raccoon');
        expect(eventSink).toHaveBeenCalledTimes(1);
        sub();
        bus.emit('foo', 'fox');
        expect(eventSink).toHaveBeenCalledTimes(1);
      });
    });

    describe('#pipe', () => {
      describe('piping into another bus', () => {
        beforeEach(() => {
          bus2 = new DownstreamTestBus({emulateListenerCount: true});
        });

        describe('given an event is raised from the parent bus', () => {
          it('handles the event on the parent bus AND the downstream bus', () => {
            spyOn(bus2 as any, 'acceptFromUpstream');
            bus.pipe(bus2);

            bus.on('foo', singleEventHandler);
            bus.emit('foo', 'wow!');

            expect(singleEventHandler).toHaveBeenCalledWith('wow!');
            expect((bus2 as any).acceptFromUpstream).toHaveBeenCalledWith('foo', 'wow!');
          });
        });

        it('feeder.pipe(hub) delivers events on the first hop', () => {
          const hub = new DownstreamTestBus({});
          const received = jasmine.createSpy('received');
          hub.on('foo', received);

          bus.pipe(hub);
          bus.emit('foo', 'relay');

          expect(received).toHaveBeenCalledWith('relay');
        });

        it('counts piped listeners as handlers when events are raised', () => {
          const onUnhandledEvent = jasmine.createSpy('onUnhandledEvent');
          bus = new Strongbus.Bus({onUnhandledEvent});
          bus.emit('foo', null);
          expect(onUnhandledEvent).toHaveBeenCalled();
          onUnhandledEvent.calls.reset();

          bus.pipe(bus2);
          bus.emit('foo', null);
          expect(onUnhandledEvent).not.toHaveBeenCalled();
          bus.unpipe(bus2);

          // removed the downstream, bus has no listeners again
          bus.emit('foo', null);
          expect(onUnhandledEvent).toHaveBeenCalled();
          onUnhandledEvent.calls.reset();

          // emulate a downstream bus with no listeners attached
          bus3 = new DownstreamTestBus({emulateListenerCount: false});
          bus.pipe(bus3);

          bus.emit('foo', null);
          expect(onUnhandledEvent).toHaveBeenCalled();
        });

        it('bubbles unhandled events to the parent regardless of whether the downstream ignores them', () => {
          const onUnhandledBus = jasmine.createSpy('onUnhandledBus');
          const onUnhandledBus3 = jasmine.createSpy('onUnhandledBus3');
          bus = new Strongbus.Bus({onUnhandledEvent: onUnhandledBus});
          bus2 = new DownstreamTestBus({onUnhandledEvent: 'ignore'});
          bus3 = new DownstreamTestBus({onUnhandledEvent: onUnhandledBus3, emulateListenerCount: false});

          bus.pipe(bus2);
          bus.pipe(bus3);
          bus.emit('foo', null);
          expect(onUnhandledBus3).toHaveBeenCalled();
          expect(onUnhandledBus).toHaveBeenCalled();
        });

        it('blocks unfiltered multi-hop passthrough and warns per unique unsound path', () => {
          const logger = jasmine.createSpyObj('logger', ['info', 'warn', 'error', 'debug']);
          bus = new Strongbus.Bus({name: 'A'});
          bus2 = new DownstreamTestBus({name: 'B', logger: () => logger});
          bus3 = new DownstreamTestBus({name: 'C'});
          const bus4 = new DownstreamTestBus({name: 'D'});
          const receivedOn3 = jasmine.createSpy('receivedOn3');
          bus3.on('foo', receivedOn3);

          spyOn(bus2 as any, 'acceptFromUpstream').and.callThrough();
          bus.pipe(bus2);
          bus2.pipe(bus3);

          bus.emit('foo', 'woot');
          expect((bus2 as any).acceptFromUpstream).toHaveBeenCalledWith('foo', 'woot');
          expect(receivedOn3).not.toHaveBeenCalled();
          expect(logger.warn).toHaveBeenCalledWith(
            StrongbusLogMessages.unsoundPipeGraph(bus2.name, bus.name, bus3.name)
          );

          logger.warn.calls.reset();
          bus2.pipe(bus4);
          expect(logger.warn).toHaveBeenCalledWith(
            StrongbusLogMessages.unsoundPipeGraph(bus2.name, bus.name, bus4.name)
          );

          logger.warn.calls.reset();
          const feeder2 = new Strongbus.Bus({name: 'A2'});
          feeder2.pipe(bus2);
          expect(logger.warn).toHaveBeenCalledWith(
            StrongbusLogMessages.unsoundPipeGraph(bus2.name, feeder2.name, bus3.name)
          );
          expect(logger.warn).toHaveBeenCalledWith(
            StrongbusLogMessages.unsoundPipeGraph(bus2.name, feeder2.name, bus4.name)
          );
        });

        it('infos when a previously unsound path is removed', () => {
          const logger = jasmine.createSpyObj('logger', ['info', 'warn', 'error', 'debug']);
          bus = new Strongbus.Bus({name: 'A'});
          bus2 = new DownstreamTestBus({name: 'B', logger: () => logger});
          bus3 = new DownstreamTestBus({name: 'C'});

          bus.pipe(bus2);
          bus2.pipe(bus3);
          expect(logger.warn).toHaveBeenCalledWith(
            StrongbusLogMessages.unsoundPipeGraph(bus2.name, bus.name, bus3.name)
          );

          logger.info.calls.reset();
          bus2.unpipe(bus3);
          expect(logger.info).toHaveBeenCalledWith(
            StrongbusLogMessages.unsoundPipeGraphResolved(bus2.name, bus.name, bus3.name)
          );

          bus2.pipe(bus3);
          expect(logger.warn).toHaveBeenCalledWith(
            StrongbusLogMessages.unsoundPipeGraph(bus2.name, bus.name, bus3.name)
          );

          logger.info.calls.reset();
          bus.unpipe(bus2);
          expect(logger.info).toHaveBeenCalledWith(
            StrongbusLogMessages.unsoundPipeGraphResolved(bus2.name, bus.name, bus3.name)
          );
        });

        it('warns when trying to add a filter to an existing unfiltered edge', () => {
          const logger = jasmine.createSpyObj('logger', ['info', 'warn', 'error', 'debug']);
          bus = new Strongbus.Bus({name: 'A'});
          bus2 = new DownstreamTestBus({name: 'B', logger: () => logger});
          bus3 = new DownstreamTestBus({name: 'C'});
          const received = jasmine.createSpy('received');
          bus3.on('foo', received);

          bus.pipe(bus2);
          bus2.pipe(bus3);
          logger.warn.calls.reset();

          bus2.pipe(Strongbus.ASSUMED_SOUND_EDGE).pipe(bus3);
          expect(logger.warn).toHaveBeenCalledWith(
            StrongbusLogMessages.unsoundPipeEdgeFilterUpgrade(bus2.name, bus3.name)
          );

          bus.emit('foo', 'still-blocked');
          expect(received).not.toHaveBeenCalled();
        });

        it('allows filtered multi-hop relay for matching events', () => {
          bus2 = new DownstreamTestBus({});
          bus3 = new DownstreamTestBus({});
          const fooOn3 = jasmine.createSpy('fooOn3');
          const barOn3 = jasmine.createSpy('barOn3');
          bus3.on('foo', fooOn3);
          bus3.on('bar', barOn3);

          bus.pipe(bus2);
          bus2.pipe((msg: Strongbus.PipedMessage<TestEventMap>) => msg.event === 'foo').pipe(bus3);

          bus.emit('foo', 'through');
          bus.emit('bar', true);

          expect(fooOn3).toHaveBeenCalledWith('through');
          expect(barOn3).not.toHaveBeenCalled();
        });

        it('delivers local emit on a bridge bus to unfiltered downstream even when inbound pipes exist', () => {
          bus2 = new DownstreamTestBus({});
          bus3 = new DownstreamTestBus({});
          const received = jasmine.createSpy('received');
          bus3.on('bar', received);

          bus.pipe(bus2);
          bus2.pipe(bus3);

          bus2.emit('bar', false);
          expect(received).toHaveBeenCalledWith(false);

          received.calls.reset();
          bus.emit('foo', 'nope');
          expect(received).not.toHaveBeenCalled();
        });
      });
    });

    describe('#unpipe', () => {
      describe('unpiping another bus', () => {
        beforeEach(() => {
          bus2 = new DownstreamTestBus({emulateListenerCount: true});
        });

        it('removes a piped msg bus', () => {
          spyOn(bus2 as any, 'acceptFromUpstream');
          bus.pipe(bus2);

          bus.emit('foo', 'wow!');

          expect((bus2 as any).acceptFromUpstream).toHaveBeenCalledWith('foo', 'wow!');
          ((bus2 as any).acceptFromUpstream as jasmine.Spy).calls.reset();

          bus.unpipe(bus2);

          bus.emit('foo', 'wow!');
          expect((bus2 as any).acceptFromUpstream).not.toHaveBeenCalled();
        });

        it('breaks the a chain of piped buses', () => {
          bus3 = new DownstreamTestBus({});
          spyOn(bus2 as any, 'acceptFromUpstream').and.callThrough();
          spyOn(bus3 as any, 'acceptFromUpstream').and.callThrough();
          const receivedOn3 = jasmine.createSpy('receivedOn3');
          bus3.on('foo', receivedOn3);

          bus.pipe(bus2).pipe(bus3);
          bus.emit('foo', null);

          expect((bus2 as any).acceptFromUpstream).toHaveBeenCalledWith('foo', null);
          expect(receivedOn3).not.toHaveBeenCalled();
          ((bus2 as any).acceptFromUpstream as jasmine.Spy).calls.reset();
          receivedOn3.calls.reset();

          bus.unpipe(bus2);
          bus.emit('foo', null);
          expect((bus2 as any).acceptFromUpstream).not.toHaveBeenCalled();
          expect(receivedOn3).not.toHaveBeenCalled();

          // bus2 is still delegating to bus3 via the chain for local emits
          bus2.emit('foo', null);
          expect(receivedOn3).toHaveBeenCalledWith(null);
        });
      });
    });
  });

  describe('#hook', () => {
    let onWillAddListener: jasmine.Spy;
    let onWillRemoveListener: jasmine.Spy;
    let onAddListener: jasmine.Spy;
    let onRemoveListener: jasmine.Spy;
    let onWillActivate: jasmine.Spy;
    let onActive: jasmine.Spy;
    let onWillIdle: jasmine.Spy;
    let onIdle: jasmine.Spy;
    let onError: jasmine.Spy;

    beforeEach(() => {
      bus.hook('willAddListener', onWillAddListener = jasmine.createSpy('onWillAddListener'));
      bus.hook('didAddListener', onAddListener = jasmine.createSpy('onAddListener'));
      bus.hook('willRemoveListener', onWillRemoveListener = jasmine.createSpy('onWillRemoveListener'));
      bus.hook('didRemoveListener', onRemoveListener = jasmine.createSpy('onRemoveListener'));
      bus.hook('willActivate', onWillActivate = jasmine.createSpy('onWillActivate'));
      bus.hook('active', onActive = jasmine.createSpy('onActive'));
      bus.hook('willIdle', onWillIdle = jasmine.createSpy('onWillIdle'));
      bus.hook('idle', onIdle = jasmine.createSpy('onIdle'));
      bus.hook('error', onError = jasmine.createSpy('error'));
    });

    it('allows subscription to meta events', () => {
      onWillActivate.and.callFake(() => expect(bus.hasListeners()).toBeFalse());
      onActive.and.callFake(() => expect(bus.hasListeners()).toBeTrue());
      onWillIdle.and.callFake(() => expect(bus.hasListeners()).toBeTrue());
      onIdle.and.callFake(() => expect(bus.hasListeners()).toBeFalse());

      const foosub = bus.on('foo', singleEventHandler);
      expect(onWillAddListener).toHaveBeenCalledWith('foo');
      expect(onAddListener).toHaveBeenCalledWith('foo');
      expect(onWillActivate).toHaveBeenCalled();
      expect(onActive).toHaveBeenCalled();

      foosub();
      expect(onWillRemoveListener).toHaveBeenCalledWith('foo');
      expect(onRemoveListener).toHaveBeenCalledWith('foo');
      expect(onWillIdle).toHaveBeenCalled();
      expect(onIdle).toHaveBeenCalled();
    });

    it('does not emit events if the subscription is invoked a second time', () => {
      const foosub = bus.on('foo', singleEventHandler);
      foosub();

      onWillRemoveListener.calls.reset();
      onRemoveListener.calls.reset();
      onWillIdle.calls.reset();
      onIdle.calls.reset();

      foosub();
      expect(onWillRemoveListener).not.toHaveBeenCalled();
      expect(onRemoveListener).not.toHaveBeenCalled();
      expect(onWillIdle).not.toHaveBeenCalled();
      expect(onIdle).not.toHaveBeenCalled();
    });

    it('only raises "willActivate" and "active" events when the bus goes from 0 to 1 listeners', () => {
      expect(bus.hasListeners()).toBeFalsy();
      bus.on('foo', singleEventHandler);
      expect(onWillActivate).toHaveBeenCalled();
      expect(onActive).toHaveBeenCalledTimes(1);
      expect(bus.hasListeners()).toBeTruthy();

      bus.on('bar', singleEventHandler);
      expect(onWillActivate).toHaveBeenCalledTimes(1);
      expect(onActive).toHaveBeenCalledTimes(1);
    });

    it('only raises "willIdle" and "idle" events when the bus goes from 1 to 0 listeners', () => {
      expect(bus.hasListeners()).toBeFalsy();
      const foosub = bus.on('foo', singleEventHandler);
      const barsub = bus.on('bar', singleEventHandler);
      expect(onWillIdle).toHaveBeenCalledTimes(0);
      expect(onIdle).toHaveBeenCalledTimes(0);

      // unsubscribe from bar
      barsub();
      expect(onWillIdle).toHaveBeenCalledTimes(0);
      expect(onIdle).toHaveBeenCalledTimes(0);

      // second bar unsubscription does not trigger onIdle
      barsub();
      expect(onWillIdle).toHaveBeenCalledTimes(0);
      expect(onIdle).toHaveBeenCalledTimes(0);

      // unsubscribing to foo now triggers the onIdle
      foosub();
      expect(onWillIdle).toHaveBeenCalledTimes(1);
      expect(onIdle).toHaveBeenCalledTimes(1);

      foosub();
      expect(onWillIdle).toHaveBeenCalledTimes(1);
      expect(onIdle).toHaveBeenCalledTimes(1);
    });

    it('can distinguish between diffierent subscriptions to the same event', () => {
      expect(bus.hasListeners()).toBeFalsy();
      const foosub1 = bus.on('foo', singleEventHandler);
      const foosub2 = bus.on('foo', () => true);
      expect(onWillIdle).toHaveBeenCalledTimes(0);
      expect(onIdle).toHaveBeenCalledTimes(0);

      // unsubscribe from bar
      foosub1();
      expect(onWillIdle).toHaveBeenCalledTimes(0);
      expect(onIdle).toHaveBeenCalledTimes(0);

      // second bar unsubscription does not trigger onIdle
      foosub1();
      expect(onWillIdle).toHaveBeenCalledTimes(0);
      expect(onIdle).toHaveBeenCalledTimes(0);

      // unsubscribing to foo now triggers the onIdle
      foosub2();
      expect(onWillIdle).toHaveBeenCalledTimes(1);
      expect(onIdle).toHaveBeenCalledTimes(1);

      foosub2();
      expect(onWillIdle).toHaveBeenCalledTimes(1);
      expect(onIdle).toHaveBeenCalledTimes(1);
    });

    describe('lifecycle hook ordering', () => {
      const otherEventHandler = jasmine.createSpy('otherEventHandler');

      it('brackets activation before the first listener add when subscribing directly', () => {
        const order: string[] = [];
        onWillAddListener.and.callFake((event) => order.push(`willAdd:${event}`));
        onAddListener.and.callFake((event) => order.push(`didAdd:${event}`));
        onWillActivate.and.callFake(() => order.push('willActivate'));
        onActive.and.callFake(() => order.push('active'));

        bus.on('foo', singleEventHandler);
        bus.on('foo', otherEventHandler);

        expect(order).toEqual([
          'willActivate',
          'willAdd:foo',
          'didAdd:foo',
          'active',
          'willAdd:foo',
          'didAdd:foo'
        ]);
      });

      it('brackets idle before the last listener remove when unsubscribing directly', () => {
        const sub1 = bus.on('foo', singleEventHandler);
        const sub2 = bus.on('foo', otherEventHandler);

        const order: string[] = [];
        onWillRemoveListener.and.callFake((event) => order.push(`willRemove:${event}`));
        onRemoveListener.and.callFake((event) => order.push(`didRemove:${event}`));
        onWillIdle.and.callFake(() => order.push('willIdle'));
        onIdle.and.callFake(() => order.push('idle'));

        sub1.unsubscribe();
        sub2.unsubscribe();

        expect(order).toEqual([
          'willRemove:foo',
          'didRemove:foo',
          'willIdle',
          'willRemove:foo',
          'didRemove:foo',
          'idle'
        ]);
      });
    });

    describe('error events', () => {
      it('emits "error" when errors are thrown in the listener', () => {
        const error = new Error('Error in callback');
        bus.on('bar', () => {
          throw error;
        });
        bus.emit('bar', true);
        expect(onError).toHaveBeenCalledWith({
          error,
          event: 'bar'
        });
      });

      it('emits "error" when the listener returns a promise that rejects', async () => {
        const error = new Error('Error in callback');
        bus.on('bar', () => (
          Promise.reject(error)
        ));
        bus.emit('bar', true);

        // wait for promises to be processed
        await Promise.resolve();

        expect(onError).toHaveBeenCalledWith({
          error,
          event: 'bar'
        });
      });

      it('emits an "error" event if a synchronous error is thrown in a hook', () => {
        const error = new Error('error');
        bus.hook('active', () => {
          throw error;
        });
        bus.on('foo', () => void(0));
        expect(onError).toHaveBeenCalledWith({
          error,
          event: 'active'
        });
      });

      it('emits "error" when a hook returns a promise that rejects', async () => {
        const error = new Error('error');
        bus.hook('active', () => (
          Promise.reject(error)
        ));
        bus.on('foo', () => void(0));

        // wait for promises to be processed
        await Promise.resolve();

        expect(onError).toHaveBeenCalledWith({
          error,
          event: 'active'
        });
      });

      describe('given the "error" handler itself fails', () => {
        let logger: jasmine.SpyObj<Logger>;
        let loggingBus: Strongbus.Bus<TestEventMap>;
        const originalError = new Error('error in listener');

        beforeEach(() => {
          logger = jasmine.createSpyObj('logger', ['info', 'warn', 'error', 'debug']);
          loggingBus = new Strongbus.Bus<TestEventMap>({logger});
          loggingBus.on('bar', () => {
            throw originalError;
          });
        });

        it('logs (rather than re-emitting "error") when the handler throws synchronously', () => {
          const handlerError = new Error('error handler exploded');
          loggingBus.hook('error', () => {
            throw handlerError;
          });

          loggingBus.emit('bar', true);

          expect(logger.error).toHaveBeenCalledWith(
            jasmine.objectContaining({
              ...StrongbusLogMessages.errorHandlerFailed({
                errorHandlerError: handlerError,
                originalEvent: 'bar',
                eventHandlerError: originalError
              }),
              context: jasmine.objectContaining({
                errorHandlerError: handlerError,
                originalEvent: 'bar',
                eventHandlerError: originalError
              })
            })
          );
        });

        it('logs (rather than re-emitting "error") when the handler returns a rejecting promise', async () => {
          const handlerError = new Error('async error handler exploded');
          loggingBus.hook('error', () => Promise.reject(handlerError));

          loggingBus.emit('bar', true);

          // wait for the rejected promise to be processed
          await sleep(1);

          expect(logger.error).toHaveBeenCalledWith(
            jasmine.objectContaining({
              ...StrongbusLogMessages.asyncErrorHandlerFailed({
                errorHandlerError: handlerError,
                originalEvent: 'bar',
                eventHandlerError: originalError
              }),
              context: jasmine.objectContaining({
                errorHandlerError: handlerError,
                originalEvent: 'bar',
                eventHandlerError: originalError
              })
            })
          );
        });
      });
    });

    describe('given bus has downstreams', () => {
      let downstream: DownstreamTestBus;
      let onDownstreamWillAddListener: jasmine.Spy;
      let onDownstreamDidAddListener: jasmine.Spy;
      let onDownstreamWillRemoveListener: jasmine.Spy;
      let onDownstreamDidRemoveListener: jasmine.Spy;
      let onDownstreamWillActivate: jasmine.Spy;
      let onDownstreamActive: jasmine.Spy;
      let onDownstreamWillIdle: jasmine.Spy;
      let onDownstreamIdle: jasmine.Spy;

      beforeEach(() => {
        downstream = new DownstreamTestBus({});
        bus.pipe(downstream);

        downstream.hook('willAddListener', onDownstreamWillAddListener = jasmine.createSpy('onDownstreamWillAddListener'));
        downstream.hook('didAddListener', onDownstreamDidAddListener = jasmine.createSpy('onDownstreamDidAddListener'));
        downstream.hook('willRemoveListener', onDownstreamWillRemoveListener = jasmine.createSpy('onDownstreamWillRemoveListener'));
        downstream.hook('didRemoveListener', onDownstreamDidRemoveListener = jasmine.createSpy('onDownstreamDidRemoveListener'));
        downstream.hook('willActivate', onDownstreamWillActivate = jasmine.createSpy('onDownstreamWillActivate'));
        downstream.hook('active', onDownstreamActive = jasmine.createSpy('onDownstreamActive'));
        downstream.hook('willIdle', onDownstreamWillIdle = jasmine.createSpy('onDownstreamWillIdle'));
        downstream.hook('idle', onDownstreamIdle = jasmine.createSpy('onDownstreamIdle'));
      });

      it('bubbles events from downstreams', () => {
        const sub = downstream.on('foo', singleEventHandler);
        expect(onDownstreamWillAddListener).toHaveBeenCalledWith('foo');
        expect(onWillAddListener).toHaveBeenCalledWith('foo');

        expect(onDownstreamDidAddListener).toHaveBeenCalledWith('foo');
        expect(onAddListener).toHaveBeenCalledWith('foo');

        expect(onDownstreamWillActivate).toHaveBeenCalled();
        expect(onWillActivate).toHaveBeenCalled();

        expect(onDownstreamActive).toHaveBeenCalled();
        expect(onActive).toHaveBeenCalled();


        sub.unsubscribe();
        expect(onDownstreamWillRemoveListener).toHaveBeenCalledWith('foo');
        expect(onRemoveListener).toHaveBeenCalledWith('foo');

        expect(onDownstreamDidRemoveListener).toHaveBeenCalledWith('foo');
        expect(onRemoveListener).toHaveBeenCalledWith('foo');

        expect(onDownstreamWillIdle).toHaveBeenCalled();
        expect(onWillIdle).toHaveBeenCalled();

        expect(onDownstreamIdle).toHaveBeenCalled();
        expect(onIdle).toHaveBeenCalled();
      });


      it('raises "active" events independently of downstreams', () => {
        expect(onActive).toHaveBeenCalledTimes(0);
        expect(onDownstreamActive).toHaveBeenCalledTimes(0);
        bus.on('foo', singleEventHandler);
        expect(onActive).toHaveBeenCalledTimes(1);
        expect(onDownstreamActive).toHaveBeenCalledTimes(0);
        downstream.on('foo', singleEventHandler);
        expect(onDownstreamActive).toHaveBeenCalledTimes(1);
        expect(onActive).toHaveBeenCalledTimes(1);
      });

      it('raises "idle" events independently of downstreams', () => {
        const foosub = bus.on('foo', singleEventHandler);
        const fooSub2 = downstream.on('foo', singleEventHandler);

        fooSub2.unsubscribe();
        expect(onDownstreamIdle).toHaveBeenCalledTimes(1);
        onDownstreamIdle.calls.reset();
        expect(onIdle).toHaveBeenCalledTimes(0);

        foosub.unsubscribe();
        expect(onDownstreamIdle).toHaveBeenCalledTimes(0);
        expect(onIdle).toHaveBeenCalledTimes(1);
      });
    });

    describe('given a downstream already has listeners before pipe', () => {
      it('bubbles add-listener hooks when the downstream link is created', () => {
        const downstream = new DownstreamTestBus({});
        downstream.on('foo', singleEventHandler);

        bus.pipe(downstream);

        expect(onWillAddListener).toHaveBeenCalledWith('foo');
        expect(onAddListener).toHaveBeenCalledWith('foo');
        expect(onWillActivate).toHaveBeenCalled();
        expect(onActive).toHaveBeenCalled();
        expect(bus.active).toBeTrue();
      });

      it('bubbles add-listener hooks from nested downstreams when the upstream link is created', () => {
        const node2 = new DownstreamTestBus({});
        const node1 = new DownstreamTestBus({});
        node2.on('foo', singleEventHandler);
        node1.pipe(node2);

        bus.pipe(node1);

        expect(onAddListener).toHaveBeenCalledWith('foo');
        expect(onActive).toHaveBeenCalled();
        expect(bus.active).toBeTrue();
      });
    });

    describe('given unpipe disconnects a downstream with listeners', () => {
      it('bubbles remove-listener hooks when the downstream link is removed', () => {
        const downstream = new DownstreamTestBus({});
        downstream.on('foo', singleEventHandler);
        bus.pipe(downstream);

        onWillRemoveListener.calls.reset();
        onRemoveListener.calls.reset();
        onWillIdle.calls.reset();
        onIdle.calls.reset();

        bus.unpipe(downstream);

        expect(onWillRemoveListener).toHaveBeenCalledWith('foo');
        expect(onRemoveListener).toHaveBeenCalledWith('foo');
        expect(onWillIdle).toHaveBeenCalled();
        expect(onIdle).toHaveBeenCalled();
      });

      it('clears downstream listeners from introspection after unpipe', () => {
        const downstream = new DownstreamTestBus({});
        downstream.on('foo', singleEventHandler);
        bus.pipe(downstream);

        expect(bus.hasListenersFor('foo')).toBeTrue();

        bus.unpipe(downstream);

        expect(bus.hasListenersFor('foo')).toBeFalse();
        expect(bus.getListenerCountFor('foo', {scope: Strongbus.ListenerScope.DOWNSTREAM})).toBe(0);
      });

      it('marks the upstream bus idle when the downstream was its only downstream demand', () => {
        const downstream = new DownstreamTestBus({});
        downstream.on('foo', singleEventHandler);
        bus.pipe(downstream);

        expect(bus.active).toBeTrue();

        bus.unpipe(downstream);

        expect(bus.active).toBeFalse();
        expect(onIdle).toHaveBeenCalled();
      });

      it('does not mark the upstream bus idle when another downstream still has listeners', () => {
        const downstream1 = new DownstreamTestBus({});
        const downstream2 = new DownstreamTestBus({});
        downstream1.on('foo', singleEventHandler);
        downstream2.on('bar', singleEventHandler);
        bus.pipe(downstream1);
        bus.pipe(downstream2);

        onWillIdle.calls.reset();
        onIdle.calls.reset();

        bus.unpipe(downstream1);

        expect(bus.active).toBeTrue();
        expect(onWillIdle).not.toHaveBeenCalled();
        expect(onIdle).not.toHaveBeenCalled();
      });
    });

    describe('given downstream sync reconciles pre-existing listeners', () => {
      const otherEventHandler = jasmine.createSpy('otherEventHandler');
      let nonCoalescingBus: Strongbus.Bus<TestEventMap>;

      beforeEach(() => {
        nonCoalescingBus = new Strongbus.Bus<TestEventMap>({coalesceDownstreamLifecycleEvents: false});
        nonCoalescingBus.hook('willAddListener', onWillAddListener = jasmine.createSpy('onWillAddListener'));
        nonCoalescingBus.hook('didAddListener', onAddListener = jasmine.createSpy('onAddListener'));
        nonCoalescingBus.hook('willRemoveListener', onWillRemoveListener = jasmine.createSpy('onWillRemoveListener'));
        nonCoalescingBus.hook('didRemoveListener', onRemoveListener = jasmine.createSpy('onRemoveListener'));
        nonCoalescingBus.hook('willActivate', onWillActivate = jasmine.createSpy('onWillActivate'));
        nonCoalescingBus.hook('active', onActive = jasmine.createSpy('onActive'));
        nonCoalescingBus.hook('willIdle', onWillIdle = jasmine.createSpy('onWillIdle'));
        nonCoalescingBus.hook('idle', onIdle = jasmine.createSpy('onIdle'));
      });

      it('emits all will-add hooks before any did-add hooks when pipe attaches a downstream', () => {
        const order: string[] = [];
        onWillAddListener.and.callFake((event) => order.push(`willAdd:${event}`));
        onAddListener.and.callFake((event) => order.push(`didAdd:${event}`));
        onWillActivate.and.callFake(() => order.push('willActivate'));
        onActive.and.callFake(() => order.push('active'));

        const downstream = new DownstreamTestBus({});
        downstream.on('foo', singleEventHandler);
        downstream.on('foo', otherEventHandler);

        nonCoalescingBus.pipe(downstream);

        expect(order).toEqual([
          'willActivate',
          'willAdd:foo',
          'didAdd:foo',
          'active',
          'willAdd:foo',
          'didAdd:foo'
        ]);
      });

      it('emits all will-remove hooks before any did-remove hooks when unpipe detaches a downstream', () => {
        const downstream = new DownstreamTestBus({});
        downstream.on('foo', singleEventHandler);
        downstream.on('foo', otherEventHandler);
        nonCoalescingBus.pipe(downstream);

        const order: string[] = [];
        onWillRemoveListener.and.callFake((event) => order.push(`willRemove:${event}`));
        onRemoveListener.and.callFake((event) => order.push(`didRemove:${event}`));
        onWillIdle.and.callFake(() => order.push('willIdle'));
        onIdle.and.callFake(() => order.push('idle'));

        nonCoalescingBus.unpipe(downstream);

        expect(order).toEqual([
          'willRemove:foo',
          'didRemove:foo',
          'willIdle',
          'willRemove:foo',
          'didRemove:foo',
          'idle'
        ]);
      });
    });

    describe('given coalesceDownstreamLifecycleEvents is enabled (default)', () => {
      const otherEventHandler = jasmine.createSpy('otherEventHandler');
      let coalescingBus: Strongbus.Bus<TestEventMap>;

      beforeEach(() => {
        coalescingBus = new Strongbus.Bus<TestEventMap>();
        coalescingBus.hook('willAddListener', onWillAddListener = jasmine.createSpy('onWillAddListener'));
        coalescingBus.hook('didAddListener', onAddListener = jasmine.createSpy('onAddListener'));
        coalescingBus.hook('willRemoveListener', onWillRemoveListener = jasmine.createSpy('onWillRemoveListener'));
        coalescingBus.hook('didRemoveListener', onRemoveListener = jasmine.createSpy('onRemoveListener'));
        coalescingBus.hook('willActivate', onWillActivate = jasmine.createSpy('onWillActivate'));
        coalescingBus.hook('active', onActive = jasmine.createSpy('onActive'));
        coalescingBus.hook('willIdle', onWillIdle = jasmine.createSpy('onWillIdle'));
        coalescingBus.hook('idle', onIdle = jasmine.createSpy('onIdle'));
      });

      it('emits one add-listener hook per event when pipe attaches a downstream', () => {
        const downstream = new DownstreamTestBus({});
        downstream.on('foo', singleEventHandler);
        downstream.on('foo', otherEventHandler);

        coalescingBus.pipe(downstream);

        expect(onWillAddListener).toHaveBeenCalledOnceWith('foo');
        expect(onAddListener).toHaveBeenCalledOnceWith('foo');
        expect(coalescingBus.getListenerCountFor('foo')).toBe(2);
        expect(onWillActivate).toHaveBeenCalled();
        expect(onActive).toHaveBeenCalled();
      });

      it('emits one remove-listener hook per event when unpipe detaches a downstream', () => {
        const downstream = new DownstreamTestBus({});
        downstream.on('foo', singleEventHandler);
        downstream.on('foo', otherEventHandler);
        coalescingBus.pipe(downstream);

        onWillRemoveListener.calls.reset();
        onRemoveListener.calls.reset();
        onWillIdle.calls.reset();
        onIdle.calls.reset();

        coalescingBus.unpipe(downstream);

        expect(onWillRemoveListener).toHaveBeenCalledOnceWith('foo');
        expect(onRemoveListener).toHaveBeenCalledOnceWith('foo');
        expect(onWillIdle).toHaveBeenCalled();
        expect(onIdle).toHaveBeenCalled();
      });

      it('does not coalesce incremental downstream listener changes after pipe', () => {
        const downstream = new DownstreamTestBus({});
        coalescingBus.pipe(downstream);

        downstream.on('foo', singleEventHandler);
        downstream.on('foo', otherEventHandler);

        expect(onWillAddListener).toHaveBeenCalledTimes(2);
        expect(onAddListener).toHaveBeenCalledTimes(2);
        expect(coalescingBus.getListenerCountFor('foo')).toBe(2);
      });

      it('preserves bracketed hook ordering when pipe attaches multiple listeners', () => {
        const order: string[] = [];
        onWillAddListener.and.callFake((event) => order.push(`willAdd:${event}`));
        onAddListener.and.callFake((event) => order.push(`didAdd:${event}`));
        onWillActivate.and.callFake(() => order.push('willActivate'));
        onActive.and.callFake(() => order.push('active'));

        const downstream = new DownstreamTestBus({});
        downstream.on('foo', singleEventHandler);
        downstream.on('foo', otherEventHandler);

        coalescingBus.pipe(downstream);

        expect(order).toEqual([
          'willActivate',
          'willAdd:foo',
          'didAdd:foo',
          'active'
        ]);
      });
    });
  });

  describe('#monitor', () => {
    let handleActiveChange: jasmine.Spy;

    beforeEach(() => {
      bus.monitor(handleActiveChange = jasmine.createSpy('handleActiveChange'));
    });

    describe('given the bus goes from 0 to 1 listeners', () => {
      it('invokes a callback with `true`', () => {
        bus.on('foo', singleEventHandler);
        expect(handleActiveChange).toHaveBeenCalledWith(true);
      });
    });

    describe('given the bus goes from 1 to 0 listeners', () => {
      it('invokes a callback with `false`', () => {
        const foosub = bus.on('foo', singleEventHandler);
        expect(handleActiveChange).toHaveBeenCalledWith(true);
        foosub();
        expect(handleActiveChange).toHaveBeenCalledWith(false);
      });
    });
  });

  describe('#hasListeners', () => {
    describe('given there are any event listeners on the instance', () => {
      it('returns true', () => {
        bus.tap(eventSink);
        expect(bus.hasListeners()).toBeTruthy();
      });
    });

    describe('given there are no listeners registered with the instance', () => {
      it('returns false', () => {
        expect(bus.hasListeners()).toBeFalsy();
      });
    });
  });

  describe('incognito', () => {
    let onWillAddListener: jasmine.Spy;
    let onWillRemoveListener: jasmine.Spy;
    let onAddListener: jasmine.Spy;
    let onRemoveListener: jasmine.Spy;
    let onWillActivate: jasmine.Spy;
    let onActive: jasmine.Spy;
    let onWillIdle: jasmine.Spy;
    let onIdle: jasmine.Spy;
    let onMonitor: jasmine.Spy;

    beforeEach(() => {
      bus.hook('willAddListener', onWillAddListener = jasmine.createSpy('onWillAddListener'));
      bus.hook('didAddListener', onAddListener = jasmine.createSpy('onAddListener'));
      bus.hook('willRemoveListener', onWillRemoveListener = jasmine.createSpy('onWillRemoveListener'));
      bus.hook('didRemoveListener', onRemoveListener = jasmine.createSpy('onRemoveListener'));
      bus.hook('willActivate', onWillActivate = jasmine.createSpy('onWillActivate'));
      bus.hook('active', onActive = jasmine.createSpy('onActive'));
      bus.hook('willIdle', onWillIdle = jasmine.createSpy('onWillIdle'));
      bus.hook('idle', onIdle = jasmine.createSpy('onIdle'));
      onMonitor = jasmine.createSpy('onMonitor');
      bus.monitor(onMonitor);
    });

    function expectNoMonitoringNoise(): void {
      expect(onWillAddListener).not.toHaveBeenCalled();
      expect(onAddListener).not.toHaveBeenCalled();
      expect(onWillRemoveListener).not.toHaveBeenCalled();
      expect(onRemoveListener).not.toHaveBeenCalled();
      expect(onWillActivate).not.toHaveBeenCalled();
      expect(onActive).not.toHaveBeenCalled();
      expect(onWillIdle).not.toHaveBeenCalled();
      expect(onIdle).not.toHaveBeenCalled();
      expect(onMonitor).not.toHaveBeenCalled();
      expect(bus.active).toBeFalse();
      expect(bus.hasListeners()).toBeFalse();
    }

    describe('own listeners', () => {
      it('delivers events without counting toward monitoring or default introspection', () => {
        const handleFoo = jasmine.createSpy('handleFoo') as (payload: string) => void;
        bus.on('foo', handleFoo, {incognito: true});

        expectNoMonitoringNoise();
        expect(bus.getListenerCount()).toBe(0);
        expect(bus.hasListenersFor('foo')).toBeFalse();
        expect(bus.getListenersFor('foo').size).toBe(0);

        bus.emit('foo', 'eagle');
        expect(handleFoo).toHaveBeenCalledWith('eagle');
      });

      it('excludes incognito handlers from forEach by default and includes them when asked', () => {
        const handleFoo = jasmine.createSpy('handleFoo') as (payload: string) => void;
        bus.on('foo', handleFoo, {incognito: true});

        const seenDefault: string[] = [];
        bus.forEach((event) => seenDefault.push(String(event)));
        expect(seenDefault).toEqual([]);

        const seenIncognito: string[] = [];
        bus.forEach((event) => seenIncognito.push(String(event)), {includeIncognito: true});
        expect(seenIncognito).toEqual(['foo']);
        expect(bus.hasListeners({includeIncognito: true})).toBeTrue();
        expect(bus.getListenerCount({includeIncognito: true})).toBe(1);
        expect(bus.getListenersFor('foo', {includeIncognito: true}).has(handleFoo)).toBeTrue();
        expect(bus.active).toBeFalse();
      });

      it('keeps the bus idle when only incognito listeners remain after a monitored listener leaves', () => {
        const monitored = jasmine.createSpy('monitored') as (payload: string) => void;
        const hidden = jasmine.createSpy('hidden') as (payload: string) => void;
        bus.on('foo', monitored);
        bus.on('foo', hidden, {incognito: true});

        expect(bus.active).toBeTrue();
        expect(bus.getListenerCount()).toBe(1);

        onWillRemoveListener.calls.reset();
        onRemoveListener.calls.reset();
        onWillIdle.calls.reset();
        onIdle.calls.reset();
        onMonitor.calls.reset();

        bus.off('foo', monitored);

        expect(onWillIdle).toHaveBeenCalled();
        expect(onIdle).toHaveBeenCalled();
        expect(onMonitor).toHaveBeenCalledWith(false);
        expect(bus.active).toBeFalse();
        expect(bus.hasListeners()).toBeFalse();

        bus.emit('foo', 'still-here');
        expect(hidden).toHaveBeenCalledWith('still-here');
      });

      it('does not idle when an incognito listener is removed while a monitored listener remains', () => {
        const monitored = jasmine.createSpy('monitored') as (payload: string) => void;
        const hidden = jasmine.createSpy('hidden') as (payload: string) => void;
        bus.on('foo', monitored);
        bus.on('foo', hidden, {incognito: true});

        onWillRemoveListener.calls.reset();
        onRemoveListener.calls.reset();
        onWillIdle.calls.reset();
        onIdle.calls.reset();
        onMonitor.calls.reset();

        bus.off('foo', hidden);

        expect(onWillRemoveListener).not.toHaveBeenCalled();
        expect(onRemoveListener).not.toHaveBeenCalled();
        expect(onWillIdle).not.toHaveBeenCalled();
        expect(onIdle).not.toHaveBeenCalled();
        expect(onMonitor).not.toHaveBeenCalled();
        expect(bus.active).toBeTrue();
        expect(bus.getListenerCount()).toBe(1);

        bus.emit('foo', 'eagle');
        expect(monitored).toHaveBeenCalledWith('eagle');
        expect(hidden).not.toHaveBeenCalled();
      });

      it('tears down an incognito on() registration via off without monitoring noise', () => {
        const handleFoo = jasmine.createSpy('handleFoo') as (payload: string) => void;
        bus.on('foo', handleFoo, {incognito: true});

        bus.off('foo', handleFoo);

        expectNoMonitoringNoise();
        bus.emit('foo', 'eagle');
        expect(handleFoo).not.toHaveBeenCalled();
      });

      it('keeps the first registration mode when on is called again with a different incognito flag', () => {
        const handleFoo = jasmine.createSpy('handleFoo') as (payload: string) => void;
        const sub1 = bus.on('foo', handleFoo);
        const sub2 = bus.on('foo', handleFoo, {incognito: true});

        expect(sub2).toBe(sub1);
        expect(bus.active).toBeTrue();
        expect(bus.getListenerCount()).toBe(1);

        onWillAddListener.calls.reset();
        onAddListener.calls.reset();

        const handleBar = jasmine.createSpy('handleBar') as (payload: boolean) => void;
        const sub3 = bus.on('bar', handleBar, {incognito: true});
        const sub4 = bus.on('bar', handleBar);

        expect(sub4).toBe(sub3);
        expect(bus.hasListenersFor('bar')).toBeFalse();
        expect(bus.hasListenersFor('bar', {includeIncognito: true})).toBeTrue();
        expect(bus.active).toBeTrue(); // still active from foo
      });

      it('supports once, any, and tap with {incognito: true}', () => {
        const handleOnce = jasmine.createSpy('handleOnce') as (payload: string) => void;
        const handleAny = jasmine.createSpy('handleAny');
        const handlePipe = jasmine.createSpy('handlePipe');

        bus.once('foo', handleOnce, {incognito: true});
        bus.any(['bar', 'baz'], handleAny, {incognito: true});
        bus.tap(handlePipe, {incognito: true});

        expectNoMonitoringNoise();

        bus.emit('foo', 'one');
        bus.emit('bar', true);
        bus.emit('baz', 3);

        expect(handleOnce).toHaveBeenCalledWith('one');
        expect(handleAny).toHaveBeenCalledWith('bar', true);
        expect(handleAny).toHaveBeenCalledWith('baz', 3);
        expect(handlePipe).toHaveBeenCalled();
        expect(bus.active).toBeFalse();
      });

      it('still invokes logger thresholds for incognito own listeners', () => {
        const logger: Logger = {
          info: jasmine.createSpy('info'),
          warn: jasmine.createSpy('warn'),
          error: jasmine.createSpy('error'),
          debug: jasmine.createSpy('debug')
        };
        bus = new Strongbus.Bus<TestEventMap>({
          name: 'incognito-thresholds',
          thresholds: {info: 2, warn: Infinity, error: Infinity},
          logger
        });

        bus.on('foo', () => undefined, {incognito: true});
        bus.on('foo', () => undefined, {incognito: true});

        expect(logger.info).toHaveBeenCalled();
      });
    });

    describe('pipe(bus, {incognito: true})', () => {
      it('forwards events without coupling target listeners into src monitoring', () => {
        const target = new Strongbus.Bus<TestEventMap>();
        const handleFoo = jasmine.createSpy('handleFoo') as (payload: string) => void;

        bus.pipe(target, {incognito: true});
        target.on('foo', handleFoo);

        expectNoMonitoringNoise();
        expect(target.active).toBeTrue();
        expect(bus.hasListeners({scope: Strongbus.ListenerScope.DOWNSTREAM})).toBeFalse();

        bus.emit('foo', 'eagle');
        expect(handleFoo).toHaveBeenCalledWith('eagle');
      });

      it('does not count multi-layer listeners under an incognito pipe link', () => {
        const mid = new Strongbus.Bus<TestEventMap>();
        const leaf = new Strongbus.Bus<TestEventMap>();
        const handleFoo = jasmine.createSpy('handleFoo') as (payload: string) => void;

        bus.pipe(mid, {incognito: true});
        // explicit filter required for passthrough across mid (inbound + outbound bridge).
        mid.pipe(Strongbus.ASSUMED_SOUND_EDGE).pipe(leaf);
        leaf.on('foo', handleFoo);

        expect(bus.active).toBeFalse();
        expect(bus.hasListeners()).toBeFalse();
        expect(mid.active).toBeTrue();
        expect(leaf.active).toBeTrue();

        bus.emit('foo', 'eagle');
        expect(handleFoo).toHaveBeenCalledWith('eagle');
      });

      it('still couples a normal pipe alongside an incognito pipe', () => {
        const hidden = new Strongbus.Bus<TestEventMap>();
        const counted = new Strongbus.Bus<TestEventMap>();
        hidden.on('foo', () => undefined);
        counted.on('bar', () => undefined);

        bus.pipe(hidden, {incognito: true});
        expect(bus.active).toBeFalse();
        expect(bus.hasListenersFor('foo')).toBeFalse();

        bus.pipe(counted);
        expect(bus.active).toBeTrue();
        expect(bus.hasListenersFor('bar')).toBeTrue();
        expect(bus.hasListenersFor('foo')).toBeFalse();
        expect(bus.hasListenersFor('foo', {includeIncognito: true})).toBeTrue();
      });

      it('stops forwarding on unpipe without detach lifecycle noise for an incognito link', () => {
        const target = new Strongbus.Bus<TestEventMap>();
        const handleFoo = jasmine.createSpy('handleFoo') as (payload: string) => void;
        bus.pipe(target, {incognito: true});
        target.on('foo', handleFoo);

        onWillRemoveListener.calls.reset();
        onRemoveListener.calls.reset();
        onWillIdle.calls.reset();
        onIdle.calls.reset();
        onMonitor.calls.reset();

        bus.unpipe(target);
        bus.emit('foo', 'eagle');

        expect(handleFoo).not.toHaveBeenCalled();
        expect(onWillRemoveListener).not.toHaveBeenCalled();
        expect(onRemoveListener).not.toHaveBeenCalled();
        expect(onWillIdle).not.toHaveBeenCalled();
        expect(onIdle).not.toHaveBeenCalled();
        expect(onMonitor).not.toHaveBeenCalled();
        expect(target.active).toBeTrue();
      });
    });

    describe('next / scan', () => {
      it('awaits next without activating the bus when incognito', async () => {
        const pending = bus.next('foo', {incognito: true});

        expectNoMonitoringNoise();

        bus.emit('foo', 'eagle');
        await expectAsync(pending).toBeResolvedTo({event: 'foo', payload: 'eagle'});
      });

      it('awaits next with a rejection trigger without activating when incognito', async () => {
        const pending = bus.next('foo', 'bar', {incognito: true});

        expectNoMonitoringNoise();

        bus.emit('bar', true);
        await expectAsync(pending).toBeRejected();
        expect(bus.active).toBeFalse();
      });

      it('scans without activating the bus when incognito', async () => {
        const pending = bus.scan('foo', (resolve) => {
          if(resolve.trigger.type === 'event' && resolve.trigger.event === 'foo') {
            resolve(resolve.trigger.payload);
          }
        }, {incognito: true, eager: false, pool: false});

        expectNoMonitoringNoise();

        bus.emit('foo', 'eagle');
        await expectAsync(pending).toBeResolvedTo('eagle');
        expect(bus.active).toBeFalse();
      });

      it('does not pool scanners across different incognito modes', async () => {
        const evaluator: Scanner.Evaluator<string, TestEventMap> = (resolve) => {
          if(resolve.trigger.type === 'event' && resolve.trigger.event === 'foo') {
            resolve(resolve.trigger.payload);
          }
        };

        const monitored = bus.scan('foo', evaluator, {eager: false, pool: true});
        monitored.catch((): void => undefined);
        expect(bus.active).toBeTrue();

        onWillAddListener.calls.reset();
        onAddListener.calls.reset();
        onMonitor.calls.reset();

        const hidden = bus.scan('foo', evaluator, {incognito: true, eager: false, pool: true});
        hidden.catch((): void => undefined);
        // a separate subscription is required; joining the monitored pool would
        // incorrectly leave the hidden waiters on a monitored listener (or vice versa).
        expect(bus.getListenerCount({includeIncognito: true})).toBeGreaterThan(1);

        monitored.cancel();
        hidden.cancel();
      });
    });
  });

  describe('#getListener', () => {
    let bus2: DownstreamTestBus;

    beforeEach(() => {
      bus2 = new DownstreamTestBus({emulateListenerCount: true});
    });

    describe('given there are event listeners on the instance', () => {
      beforeEach(() => {
        bus.on('foo', singleEventHandler);
      });

      describe('and the instance has no downstreams', () => {
        it('lists the listeners on the instance', () => {
          expect(combinedListenersToMap(bus)).toEqual(new Map([[
            'foo', new Set([singleEventHandler])
          ]]));
          bus.tap(eventSink);
          expect(bus.getListenersFor('foo')).toEqual(new Set([singleEventHandler]));
          expect(bus.getListenersFor('*').size).toEqual(1); // will be an anonymous wrapper around `onEveryEvent`
        });
      });

      describe('and the instance has downstreams with no listeners', () => {
        it("lists the instance's listeners", () => {
          bus.pipe(bus2);
          expect(combinedListenersToMap(bus)).toEqual(new Map([[
            'foo', new Set([singleEventHandler])
          ]]));
        });
      });

      describe('and the instance has downstreams with listeners', () => {
        it("lists the instance's listeners and the downstream listeners", () => {
          bus.pipe(bus2);
          bus2.on('foo', eventSink);
          expect(combinedListenersToMap(bus)).toEqual(new Map([[
            'foo', new Set([singleEventHandler, eventSink])
          ]]));
        });
      });
    });

    describe('given there are no event listeners on the instance', () => {
      describe('and the instance has downstreams with listeners', () => {
        it('lists the downstream listeners', () => {
          bus.pipe(bus2);
          bus2.on('foo', eventSink);
          expect(combinedListenersToMap(bus)).toEqual(new Map([[
            'foo', new Set([eventSink])
          ]]));
        });
      });

      describe('and the instance has downstreams with no listeners', () => {
        it('lists no listeners', () => {
          bus.pipe(bus2);
          expect(bus.getEventCount()).toEqual(0);
        });
      });

      describe('and the instance has no downstreams', () => {
        it('lists no listeners', () => {
          expect(bus.getEventCount()).toEqual(0);
        });
      });
    });

    describe('given listeners change between lookups', () => {
      it('reflects listeners added on the instance', () => {
        bus.on('foo', singleEventHandler);
        expect(bus.getEventCount()).toEqual(1);
        bus.on('bar', singleEventHandler);
        expect(bus.getEventCount()).toEqual(2);
      });

      it('reflects listeners removed from the instance', () => {
        bus.on('foo', singleEventHandler);
        const sub = bus.on('bar', singleEventHandler);
        expect(bus.getEventCount()).toEqual(2);
        sub.unsubscribe();
        expect(bus.getEventCount()).toEqual(1);
      });

      describe('given the instance has downstreams', () => {
        beforeEach(() => {
          bus.pipe(bus2);
        });

        it('reflects listeners added on a downstream', () => {
          bus.on('foo', singleEventHandler);
          expect(bus.getEventCount()).toEqual(1);
          bus2.on('bar', singleEventHandler);
          expect(bus.getEventCount()).toEqual(2);
        });

        it('reflects listeners removed from a downstream', () => {
          bus.on('foo', singleEventHandler);
          const sub = bus2.on('bar', singleEventHandler);
          expect(bus.getEventCount()).toEqual(2);
          sub.unsubscribe();
          expect(bus.getEventCount()).toEqual(1);
        });
      });
    });
  });

  describe('#getOwnListener', () => {
    let bus2: DownstreamTestBus;

    beforeEach(() => {
      bus2 = new DownstreamTestBus({emulateListenerCount: true});
    });

    describe('given there are event listeners on the instance', () => {
      beforeEach(() => {
        bus.on('foo', singleEventHandler);
      });

      describe('and the instance has no downstreams', () => {
        it("lists the instance's listeners", () => {
          expect(ownListenersToMap(bus)).toEqual(new Map([[
            'foo', new Set([singleEventHandler])
          ]]));
          bus.tap(eventSink);
          expect(bus.getListenersFor('foo', {scope: Strongbus.ListenerScope.OWN})).toEqual(new Set([singleEventHandler]));
          expect(bus.getListenersFor('*', {scope: Strongbus.ListenerScope.OWN}).size).toEqual(1); // will be an anonymous wrapper around `onEveryEvent`
        });
      });

      describe('and the instance has downstreams with no listeners', () => {
        it("lists the instance's listeners", () => {
          bus.pipe(bus2);
          expect(ownListenersToMap(bus)).toEqual(new Map([[
            'foo', new Set([singleEventHandler])
          ]]));
        });
      });

      describe('and the instance has downstreams with listeners', () => {
        it("lists only the instance's listeners", () => {
          bus.pipe(bus2);
          bus2.on('foo', eventSink);
          expect(ownListenersToMap(bus)).toEqual(new Map([[
            'foo', new Set([singleEventHandler])
          ]]));
        });
      });
    });

    describe('given there are no event listeners on the instance', () => {
      describe('and the instance has downstreams with listeners', () => {
        it('lists no listeners', () => {
          bus.pipe(bus2);
          bus2.on('foo', eventSink);
          expect(bus.getEventCount({scope: Strongbus.ListenerScope.OWN})).toEqual(0);
        });
      });

      describe('and the instance has downstreams with no listeners', () => {
        it('lists no listeners', () => {
          bus.pipe(bus2);
          expect(bus.getEventCount({scope: Strongbus.ListenerScope.OWN})).toEqual(0);
        });
      });

      describe('and the instance has no downstreams', () => {
        it('lists no listeners', () => {
          expect(bus.getEventCount({scope: Strongbus.ListenerScope.OWN})).toEqual(0);
        });
      });
    });

    describe('given own listeners change between lookups', () => {
      it('reflects listeners added on the instance', () => {
        bus.on('foo', singleEventHandler);
        expect(bus.getEventCount({scope: Strongbus.ListenerScope.OWN})).toEqual(1);
        bus.on('bar', singleEventHandler);
        expect(bus.getEventCount({scope: Strongbus.ListenerScope.OWN})).toEqual(2);
      });

      it('is unaffected by downstream listener changes', () => {
        bus.pipe(bus2);
        bus.on('foo', singleEventHandler);
        expect(bus.getEventCount({scope: Strongbus.ListenerScope.OWN})).toEqual(1);
        bus2.on('bar', singleEventHandler);
        expect(bus.getEventCount({scope: Strongbus.ListenerScope.OWN})).toEqual(1);
      });
    });
  });

  describe('#getListenerCountFor', () => {
    describe('given an instance has no listeners registered for an event', () => {
      it('returns 0', () => {
        bus.destroy();
        expect(bus.getListenerCountFor('foo')).toBe(0);
      });

      describe('given an instance has downstreams registered for an event', () => {
        it('returns a positive count', () => {
          bus.destroy();
          const bus2 = new DownstreamTestBus({emulateListenerCount: true});
          bus.pipe(bus2);
          bus2.on('foo', () => {return; });
          expect(bus.getListenerCountFor('foo')).toBeGreaterThan(0);
        });
      });
    });

    describe('given an instance has listeners registered for an event', () => {
      it('returns a positive count', () => {
        bus.destroy();
        const handleFoo = (payload: string) => {return; };
        bus.on('foo', handleFoo);

        expect(bus.getListenerCountFor('foo')).toBe(1);
      });
    });
  });

  describe('#getOwnListenerCount', () => {
    describe('given an instance has no listeners registered for an event', () => {
      it('returns 0', () => {
        bus.destroy();
        expect(bus.getListenerCountFor('foo', {scope: Strongbus.ListenerScope.OWN})).toBe(0);
      });

      describe('given an instance has downstreams registered for an event', () => {
        it('returns 0', () => {
          bus.destroy();
          const bus2 = new DownstreamTestBus({emulateListenerCount: true});
          bus.pipe(bus2);
          bus2.on('foo', () => {return; });
          expect(bus.getListenerCountFor('foo', {scope: Strongbus.ListenerScope.OWN})).toBe(0);
        });
      });
    });

    describe('given an instance has listeners registered for an event', () => {
      it('returns a positive count', () => {
        bus.destroy();
        const handleFoo = (payload: string) => {return; };
        bus.on('foo', handleFoo);

        expect(bus.getListenerCountFor('foo', {scope: Strongbus.ListenerScope.OWN})).toBe(1);
      });
    });
  });

  describe('#getDownstreamListenerCount', () => {
    describe('given an instance has no downstream listeners for an event', () => {
      it('returns 0', () => {
        bus.destroy();
        expect(bus.getListenerCountFor('foo', {scope: Strongbus.ListenerScope.DOWNSTREAM})).toBe(0);
      });

      describe('given an instance has only own listeners for an event', () => {
        it('returns 0', () => {
          bus.destroy();
          bus.on('foo', () => undefined);
          expect(bus.getListenerCountFor('foo', {scope: Strongbus.ListenerScope.DOWNSTREAM})).toBe(0);
        });
      });
    });

    describe('given a piped downstream has listeners for an event', () => {
      it('returns a positive count', () => {
        bus.destroy();
        const bus2 = new DownstreamTestBus({emulateListenerCount: true});
        bus.pipe(bus2);
        bus2.on('foo', () => undefined);
        expect(bus.getListenerCountFor('foo', {scope: Strongbus.ListenerScope.DOWNSTREAM})).toBeGreaterThan(0);
      });
    });
  });

  describe('#getListenerCount', () => {
    describe('given an instance has no downstreams', () => {
      it('counts listeners for the instance', () => {
        bus.on('foo', singleEventHandler);
        bus.on('bar', () => ({}));

        expect(bus.getListenerCount()).toEqual(2);
      });
    });

    describe('given an instance has downstreams', () => {
      let bus2: DownstreamTestBus;
      beforeEach(() => {
        bus2 = new DownstreamTestBus({emulateListenerCount: true});
        bus.pipe(bus2);
      });

      describe('and a downstream has listeners', () => {
        it('counts listeners for the instance and its downstreams', () => {
          bus.on('foo', singleEventHandler);
          bus.on('bar', () => ({}));
          bus2.on('foo', singleEventHandler);

          expect(bus.getListenerCount()).toEqual(3);
        });
      });

      describe('and downstreams have no listeners', () => {
        it('counts listeners for the instance and its downstreams', () => {
          bus.on('foo', singleEventHandler);
          bus.on('bar', () => ({}));

          expect(bus.getListenerCount()).toEqual(2);
        });
      });
    });
  });

  describe('#getListenerCount', () => {
    describe('given an instance has no downstreams', () => {
      it('counts listeners for the instance', () => {
        const sub1 = bus.on('foo', singleEventHandler);
        const sub2 = bus.on('bar', () => ({}));

        expect(bus.getListenerCount()).toEqual(2);
        sub1.unsubscribe();
        expect(bus.getListenerCount()).toEqual(1);
        sub2.unsubscribe();
        expect(bus.getListenerCount()).toEqual(0);
      });
    });

    describe('given an instance has downstreams', () => {
      let bus2: DownstreamTestBus;
      beforeEach(() => {
        bus2 = new DownstreamTestBus({emulateListenerCount: true});
        bus.pipe(bus2);
      });

      describe('and a downstream has listeners', () => {
        it('counts listeners for the instance and its downstreams', () => {
          const sub1 = bus.on('foo', singleEventHandler);
          const sub2 = bus.on('bar', () => ({}));
          const sub3 = bus2.on('foo', singleEventHandler);

          expect(bus.getListenerCount()).toEqual(3);
          sub1.unsubscribe();
          expect(bus.getListenerCount()).toEqual(2);
          sub2.unsubscribe();
          expect(bus.getListenerCount()).toEqual(1);
          sub3.unsubscribe();
          expect(bus.getListenerCount()).toEqual(0);
          sub1.unsubscribe();
          expect(bus.getListenerCount()).toEqual(0);
        });
      });

      describe('and downstreams have no listeners', () => {
        it('counts listeners for the instance and its downstreams', () => {
          bus.on('foo', singleEventHandler);
          bus.on('bar', () => ({}));

          expect(bus.getListenerCount()).toEqual(2);
        });
      });
    });
  });

  describe('#destroy', () => {
    it('removes all event listeners, triggering proper lifecycle events', () => {
      const onUnhandledEvent = jasmine.createSpy('onUnhandledEvent');
      bus = new Strongbus.Bus({onUnhandledEvent});
      const willRemoveListenerSpy = jasmine.createSpy('willRemoveListener');
      const didRemoveListenerSpy = jasmine.createSpy('didRemoveListener');
      bus.on('foo', singleEventHandler);
      bus.hook('willRemoveListener', willRemoveListenerSpy);
      bus.hook('didRemoveListener', didRemoveListenerSpy);
      bus.tap(eventSink);

      bus.emit('foo', null);
      expect(singleEventHandler).toHaveBeenCalled();
      singleEventHandler.calls.reset();
      eventSink.calls.reset();

      bus.destroy();

      expect(willRemoveListenerSpy).toHaveBeenCalledWith('foo');
      expect(didRemoveListenerSpy).toHaveBeenCalledWith('foo');
      expect(bus.getListenerCountFor('foo')).toBe(0);
      bus.emit('foo', null);
      expect(singleEventHandler).not.toHaveBeenCalled();
      expect(eventSink).not.toHaveBeenCalled();
      expect(onUnhandledEvent).toHaveBeenCalled();
    });

    it('removes all hooks', () => {
      const didAddListenerSpy = jasmine.createSpy('onAddListener');
      bus.hook('didAddListener', didAddListenerSpy);
      bus.on('foo', singleEventHandler);
      expect(didAddListenerSpy).toHaveBeenCalledWith('foo');
      didAddListenerSpy.calls.reset();

      bus.destroy();
      bus.on('foo', singleEventHandler);
      expect(didAddListenerSpy).not.toHaveBeenCalled();
    });

    it('clears all downstreams', () => {
      const bus2 = new DownstreamTestBus({});
      bus2.on('foo', singleEventHandler);
      bus2.tap(eventSink);

      bus.pipe(bus2);

      bus.emit('foo', null);
      expect(singleEventHandler).toHaveBeenCalled();
      expect(eventSink).toHaveBeenCalled();
      singleEventHandler.calls.reset();
      eventSink.calls.reset();

      bus.destroy();
      bus.emit('foo', null);
      expect(singleEventHandler).not.toHaveBeenCalled();
      expect(eventSink).not.toHaveBeenCalled();
    });
  });

  describe('Reserved events', () => {
    describe('given the wildcard (*) event is manually raised', () => {
      it('raises an error', () => {
        bus.tap(eventSink);
        const shouldThrow = () => bus.emit('*' as any, 'eagle');

        expect(shouldThrow).toThrow();
      });
    });
  });

  describe('unsubscribe function return values (Subscription)s', () => {
    describe('given it is invoked multiple times', () => {
      it('only invokes lifecycle methods once', () => {
        const onWillRemoveListener = jasmine.createSpy('willRemoveListener');
        const onDidRemoveListener = jasmine.createSpy('didAddListener');
        const onWillIdle = jasmine.createSpy('willIdle');
        const onIdle = jasmine.createSpy('idle');
        bus.hook('willRemoveListener', onWillRemoveListener);
        bus.hook('didRemoveListener', onDidRemoveListener);
        bus.hook('willIdle', onWillIdle);
        bus.hook('idle', onIdle);

        const unsub = bus.on('foo', singleEventHandler);

        unsub();

        expect(onWillRemoveListener).toHaveBeenCalled();
        expect(onDidRemoveListener).toHaveBeenCalled();
        expect(onWillIdle).toHaveBeenCalled();
        expect(onIdle).toHaveBeenCalled();

        onWillRemoveListener.calls.reset();
        onDidRemoveListener.calls.reset();
        onWillIdle.calls.reset();
        onIdle.calls.reset();

        unsub();

        expect(onWillRemoveListener).not.toHaveBeenCalled();
        expect(onDidRemoveListener).not.toHaveBeenCalled();
        expect(onWillIdle).not.toHaveBeenCalled();
        expect(onIdle).not.toHaveBeenCalled();
      });
    });
  });

  describe('#next', () => {
    let onResolve: jasmine.Spy;
    let onReject: jasmine.Spy;

    beforeEach(() => {
      onResolve = jasmine.createSpy('onResolve');
      onReject = jasmine.createSpy('onReject');

      // uncomment the following and note the type error
      // because the sets of resolving and rejecting events aren't disjoint

      // bus.next('foo', 'foo');
      // bus.next('foo', ['foo']);
      // bus.next(['foo'], 'foo');
      // bus.next('*', 'foo');
      // bus.next('*', ['foo']);
    });

    describe('given both resolving and rejecting events', () => {
      beforeEach(() => {
        const p = bus.next('foo', 'bar');
        p.then(onResolve).catch(onReject);
        expect(onResolve).not.toHaveBeenCalled();
        expect(onReject).not.toHaveBeenCalled();
      });

      describe('when the resolving event is raised', () => {
        it('resolves the promise', async () => {
          bus.emit('foo', 'FOO!');
          await sleep(1);
          expect(onReject).not.toHaveBeenCalled();
          expect(onResolve).toHaveBeenCalledWith({event: 'foo', payload: 'FOO!'});
          onResolve.calls.reset();
          bus.emit('foo', 'BAR!');
          expect(onResolve).not.toHaveBeenCalled();
          expect(onReject).not.toHaveBeenCalled();
        });

        it('unsubscribes from the event source', () => {
          expect(combinedListenerEvents(bus)).toEqual(['foo', 'bar']);
          bus.emit('foo', 'FOO!');
          expect(combinedListenerEvents(bus)).toEqual([]);
        });
      });

      describe('when the rejecting event is raised', () => {
        beforeEach(() => {
          const p = bus.next('foo', 'bar');
          p.then(onResolve).catch(onReject);
          expect(onResolve).not.toHaveBeenCalled();
          expect(onReject).not.toHaveBeenCalled();
        });

        it('rejects the promise', async () => {
          bus.emit('bar', true);
          await sleep(1);
          expect(onResolve).not.toHaveBeenCalled();
          expect(onReject).toHaveBeenCalled();
          onReject.calls.reset();
          bus.emit('bar', false);
          expect(onResolve).not.toHaveBeenCalled();
          expect(onReject).not.toHaveBeenCalled();
        });

        it('unsubscribes from the event source', () => {
          expect(combinedListenerEvents(bus)).toEqual(['foo', 'bar']);
          bus.emit('bar', true);
          expect(combinedListenerEvents(bus)).toEqual([]);
        });
      });
    });

    describe('given only the resolving event', () => {
      beforeEach(() => {
        const p = bus.next('foo');
        p.then(onResolve).catch(onReject);
        expect(onResolve).not.toHaveBeenCalled();
        expect(onReject).not.toHaveBeenCalled();
      });

      describe('when the resolving event is raised', () => {
        it('resolves the promise', async () => {
          bus.emit('foo', 'FOO!');
          await sleep(1);
          expect(onReject).not.toHaveBeenCalled();
          expect(onResolve).toHaveBeenCalledWith({event: 'foo', payload: 'FOO!'});
          onResolve.calls.reset();
          bus.emit('foo', 'BAR!');
          expect(onResolve).not.toHaveBeenCalled();
          expect(onReject).not.toHaveBeenCalled();
        });

        it('unsubscribes from the event source', () => {
          expect(combinedListenerEvents(bus)).toEqual(['foo']);
          bus.emit('foo', 'FOO!');
          expect(combinedListenerEvents(bus)).toEqual([]);
        });
      });
    });

    describe('given the promise is canceled', () => {
      it('unsubscribes from the event source', async () => {
        const p = bus.next('foo');
        p.then(onResolve).catch(onReject);
        expect(combinedListenerEvents(bus)).toEqual(['foo']);
        p.cancel();
        await sleep(1);
        expect(onReject).toHaveBeenCalled();
        expect(combinedListenerEvents(bus)).toEqual([]);
      });
    });

    describe('given the resolving event is every event in the map', () => {
      it('resolves on any event with the triggering event and payload', async () => {
        const p1 = bus.next(ALL_TEST_EVENTS);
        p1.then(onResolve);
        bus.emit('baz', 3);
        await sleep(1);
        expect(onResolve).toHaveBeenCalledWith({event: 'baz', payload: 3});
        onResolve.calls.reset();
        const p2 = bus.next(ALL_TEST_EVENTS);
        p2.then(onResolve);
        bus.emit('foo', 'FOO!');
        await sleep(1);
        expect(onResolve).toHaveBeenCalledWith({event: 'foo', payload: 'FOO!'});
      });
    });

    describe('given an array of resolving events', () => {
      it('resolves on any of the events in the array with the triggering event and payload', async () => {
        const p1 = bus.next(['bar', 'baz']);
        p1.then(onResolve);
        bus.emit('baz', 5);
        await sleep(1);
        expect(onResolve).toHaveBeenCalledWith({event: 'baz', payload: 5});
        onResolve.calls.reset();
        const p2 = bus.next(['foo', 'baz']);
        p2.then(onResolve);
        bus.emit('foo', 'FOO!');
        await sleep(1);
        expect(onResolve).toHaveBeenCalledWith({event: 'foo', payload: 'FOO!'});
      });
    });

    describe('given an array of rejecting events', () => {
      it('rejects on any of the events in the array', async () => {
        const p1 = bus.next('foo', ['bar', 'baz']);
        p1.catch(onReject);
        bus.emit('baz', 2);
        await sleep(1);
        expect(onReject).toHaveBeenCalled();
        onReject.calls.reset();
        const p2 = bus.next('bar', ['foo', 'baz']);
        p2.catch(onReject);
        bus.emit('foo', 'FOO!');
        await sleep(1);
        expect(onReject).toHaveBeenCalled();
      });
    });

    describe('given the bus is destroyed', () => {
      it('rejects the promise', async () => {
        const p = bus.next('foo');
        p.then(onResolve).catch(onReject);
        bus.destroy();
        await sleep(1);
        expect(onReject).toHaveBeenCalled();
        expect(combinedListenerEvents(bus)).toEqual([]);
      });
    });
  });

  describe('#scan', () => {
    let onResolve: jasmine.Spy;
    let onReject: jasmine.Spy;

    beforeEach(() => {
      onResolve = jasmine.createSpy('onResolve');
      onReject = jasmine.createSpy('onReject');
    });

    describe('given an evaluation resolves when triggered', () => {
      describe('using multi-arity syntax for evaluator', () => {
        it('resolves the promise', async () => {
          let hasFoo: boolean = false;
          const evaluator = (resolve: Scanner.Resolver<boolean>, reject: Scanner.Rejecter) => {
            if(hasFoo) {
              resolve(true);
            }
          };
          const p = bus.scan({
            evaluator,
            trigger: 'foo'
          });

          p.then(onResolve).catch(onReject);

          bus.emit('foo', 'FOO!');

          expect(onResolve).not.toHaveBeenCalled();
          expect(onReject).not.toHaveBeenCalled();

          hasFoo = true;

          bus.emit('foo', 'FOO!');
          await sleep(1);
          expect(onResolve).toHaveBeenCalledWith(true);
          onResolve.calls.reset();

          bus.emit('foo', 'FOO!');
          await sleep(1);
          expect(onResolve).not.toHaveBeenCalled();

          expect(combinedListenerEvents(bus)).toEqual([]);
        });
      });

      describe('using single-arity object argument syntax for evaluator', () => {
        let onTrigger: jasmine.Spy;

        beforeEach(() => {
          onTrigger = jasmine.createSpy('onTrigger');
        });

        it('resolves the promise', async () => {
          let hasFoo: boolean = false;
          const evaluator = ({resolve, trigger}: Scanner.Resolver<boolean>) => {
            onTrigger(trigger);
            if(hasFoo) {
              resolve(true);
            }
          };
          const p = bus.scan({
            evaluator,
            trigger: 'foo'
          });

          expect(onTrigger).toHaveBeenCalledWith({
            type: 'eager',
            event: null,
            payload: null
          });

          p.then(onResolve).catch(onReject);

          bus.emit('foo', 'FOO!');

          expect(onTrigger).toHaveBeenCalledWith({
            type: 'event',
            event: 'foo',
            payload: 'FOO!'
          });
          onTrigger.calls.reset();

          expect(onResolve).not.toHaveBeenCalled();
          expect(onReject).not.toHaveBeenCalled();

          hasFoo = true;

          bus.emit('foo', 'BAR!');
          expect(onTrigger).toHaveBeenCalledWith({
            type: 'event',
            event: 'foo',
            payload: 'BAR!'
          });
          onTrigger.calls.reset();

          await sleep(1);
          expect(onResolve).toHaveBeenCalledWith(true);
          onResolve.calls.reset();

          bus.emit('foo', 'FOO!');
          expect(onTrigger).not.toHaveBeenCalled();
          await sleep(1);
          expect(onResolve).not.toHaveBeenCalled();

          expect(combinedListenerEvents(bus)).toEqual([]);
        });
      });
    });

    describe('given an evaluation rejects when triggered', () => {
      it('rejects the promise', async () => {
        let hasFoo: boolean = false;
        const evaluator = (resolve: Scanner.Resolver<boolean>, reject: Scanner.Rejecter) => {
          if(hasFoo) {
            reject(new Error('unexpected foo'));
          }
        };
        const p = bus.scan({
          evaluator,
          trigger: 'foo'
        });

        p.then(onResolve).catch(onReject);

        bus.emit('foo', 'FOO!');

        expect(onResolve).not.toHaveBeenCalled();
        expect(onReject).not.toHaveBeenCalled();

        hasFoo = true;

        bus.emit('foo', 'FOO!');
        await sleep(1);
        expect(onReject).toHaveBeenCalled();
        onReject.calls.reset();

        bus.emit('foo', 'FOO!');
        await sleep(1);
        expect(onReject).not.toHaveBeenCalled();

        expect(combinedListenerEvents(bus)).toEqual([]);
      });
    });

    describe('given the bus is destroyed', () => {
      describe("and the evaluator's last invocation resolves", () => {
        it('resolves the promise', async () => {
          let hasFoo: boolean = false;
          const evaluator = (resolve: Scanner.Resolver<boolean>, reject: Scanner.Rejecter) => {
            if(hasFoo) {
              resolve(true);
            }
          };
          const p = bus.scan({
            evaluator,
            trigger: 'foo'
          });

          p.then(onResolve).catch(onReject);

          hasFoo = true;
          bus.destroy();

          await sleep(1);
          expect(onResolve).toHaveBeenCalledWith(true);
        });
      });

      describe("and the evaluator's last invocation rejects", () => {
        it("rejects the promise with the evaluator's error", async () => {
          let hasFoo: boolean = false;
          const evaluator = (resolve: Scanner.Resolver<boolean>, reject: Scanner.Rejecter) => {
            if(hasFoo) {
              reject(new Error('unexpected foo'));
            }
          };
          const p = bus.scan({
            evaluator,
            trigger: 'foo'
          });

          p.then(onResolve).catch(onReject);

          hasFoo = true;
          bus.destroy();

          await sleep(1);
          const rejection = onReject.calls.mostRecent().args[0];
          expect(rejection.message).toEqual('unexpected foo');
        });
      });

      describe("and the evaluator's last invocation neither resolves or rejects", () => {
        it('rejects the promise with a cancelation error', async () => {
          const evaluator = (resolve: Scanner.Resolver<boolean>, reject: Scanner.Rejecter) => {
            // doing nothing in the evaluator
            return;
          };
          const p = bus.scan({
            evaluator,
            trigger: 'foo'
          });

          p.then(onResolve).catch(onReject);

          bus.destroy();

          await sleep(1);
          const rejection = onReject.calls.mostRecent().args[0];
          expect(rejection).toEqual('All Scannables have been destroyed');
        });
      });
    });

    describe('given the evaluation condition is already in the resolution state (eager evaluation)', () => {
      it('resolves the promise without waiting for an event', async () => {
        const hasFoo: boolean = true;
        const evaluator = (resolve: Scanner.Resolver<boolean>, reject: Scanner.Rejecter) => {
          if(hasFoo) {
            resolve(true);
          }
        };
        const p = bus.scan({
          evaluator,
          trigger: 'foo'
        });

        p.then(onResolve);
        await sleep(1);

        expect(onResolve).toHaveBeenCalledWith(true);

      });
    });

    describe('and params.eager=false', () => {
      it('does not resolve the promise until it receives an event triggering evaluation', async () => {
        const hasFoo: boolean = true;
        const evaluator = (resolve: Scanner.Resolver<boolean>, reject: Scanner.Rejecter) => {
          if(hasFoo) {
            resolve(true);
          }
        };
        const p = bus.scan({
          evaluator,
          trigger: 'foo',
          eager: false
        });

        p.then(onResolve);
        await sleep(1);

        expect(onResolve).not.toHaveBeenCalled();

        bus.emit('foo', 'FOO!');
        await sleep(1);

        expect(onResolve).toHaveBeenCalledWith(true);
      });
    });

    describe('Scanner pooling', () => {
      describe('given multiple scan invocations in which params.evaluator and params.eager are the same', () => {
        describe('given params.trigger is the same single event', () => {
          it('returns the same promise object', () => {
            const evaluator = (resolve: Scanner.Resolver<boolean>, reject: Scanner.Rejecter) => {
              // doing nothing in the evaluator
              return;
            };

            const p1 = bus.scan({
              evaluator,
              trigger: 'foo'
            });
            const p2 = bus.scan({
              evaluator,
              trigger: 'foo'
            });

            expect((p1 as any)[INTERNAL_PROMISE] === (p2 as any)[INTERNAL_PROMISE]).toBeTrue();
          });
        });

        describe('given params.trigger is the same vector of events in the same order', () => {
          it('returns the same promise object', () => {
            const evaluator = (resolve: Scanner.Resolver<boolean>, reject: Scanner.Rejecter) => {
              // doing nothing in the evaluator
              return;
            };

            const p1 = bus.scan({
              evaluator,
              trigger: ['foo', 'bar']
            });
            const p2 = bus.scan({
              evaluator,
              trigger: ['foo', 'bar']
            });

            expect((p1 as any)[INTERNAL_PROMISE] === (p2 as any)[INTERNAL_PROMISE]).toBeTrue();
          });
        });

        describe('given params.trigger is the same vector of events in a different order', () => {
          it('returns the same promise object', () => {
            const evaluator = (resolve: Scanner.Resolver<boolean>, reject: Scanner.Rejecter) => {
              // doing nothing in the evaluator
              return;
            };

            const p1 = bus.scan({
              evaluator,
              trigger: ['foo', 'bar']
            });
            const p2 = bus.scan({
              evaluator,
              trigger: ['bar', 'foo']
            });

            expect((p1 as any)[INTERNAL_PROMISE] === (p2 as any)[INTERNAL_PROMISE]).toBeTrue();
          });
        });

        describe('given params.trigger is a subset of an existing vector of events', () => {
          it('returns the same promise object', () => {
            const evaluator = (resolve: Scanner.Resolver<boolean>, reject: Scanner.Rejecter) => {
              // doing nothing in the evaluator
              return;
            };

            const p1 = bus.scan({
              evaluator,
              trigger: ['foo', 'bar']
            });
            const p2 = bus.scan({
              evaluator,
              trigger: ['bar']
            });
            const p3 = bus.scan({
              evaluator,
              trigger: 'foo'
            });

            expect((p1 as any)[INTERNAL_PROMISE] === (p2 as any)[INTERNAL_PROMISE]).toBeTrue();
            expect((p2 as any)[INTERNAL_PROMISE] === (p3 as any)[INTERNAL_PROMISE]).toBeTrue();
          });
        });

        describe('given params.trigger is a subset of an existing wildcard scan', () => {
          it('returns the same promise object', () => {
            const evaluator = (resolve: Scanner.Resolver<boolean>, reject: Scanner.Rejecter) => {
              // doing nothing in the evaluator
              return;
            };

            const p1 = bus.scan({
              evaluator,
              trigger: '*'
            });
            const p2 = bus.scan({
              evaluator,
              trigger: ['bar']
            });
            const p3 = bus.scan({
              evaluator,
              trigger: 'foo'
            });
            const p4 = bus.scan({
              evaluator,
              trigger: ['foo', 'bar']
            });
            const p5 = bus.scan({
              evaluator,
              trigger: '*'
            });

            expect((p1 as any)[INTERNAL_PROMISE] === (p2 as any)[INTERNAL_PROMISE]).toBeTrue();
            expect((p2 as any)[INTERNAL_PROMISE] === (p3 as any)[INTERNAL_PROMISE]).toBeTrue();
            expect((p3 as any)[INTERNAL_PROMISE] === (p4 as any)[INTERNAL_PROMISE]).toBeTrue();
            expect((p4 as any)[INTERNAL_PROMISE] === (p5 as any)[INTERNAL_PROMISE]).toBeTrue();
          });
        });
      });

      describe('given params.trigger is NOT subset of an existing trigger', () => {
        it('returns different promise objects', () => {
          const evaluator = (resolve: Scanner.Resolver<boolean>, reject: Scanner.Rejecter) => {
            // doing nothing in the evaluator
            return;
          };

          const p1 = bus.scan({
            evaluator,
            trigger: ['foo', 'bar']
          });
          const p2 = bus.scan({
            evaluator,
            trigger: ['bar', 'baz']
          });
          const p3 = bus.scan({
            evaluator,
            trigger: '*'
          });

          expect((p1 as any)[INTERNAL_PROMISE] === (p2 as any)[INTERNAL_PROMISE]).toBeFalse();
          expect((p1 as any)[INTERNAL_PROMISE] === (p3 as any)[INTERNAL_PROMISE]).toBeFalse();
          expect((p2 as any)[INTERNAL_PROMISE] === (p3 as any)[INTERNAL_PROMISE]).toBeFalse();
        });
      });

      describe('given params.trigger is the wildcard', () => {
        describe('and a pooled scanner exists for the wildcard already', () => {
          it('returns the same promise object', () => {
            const evaluator = (resolve: Scanner.Resolver<boolean>, reject: Scanner.Rejecter) => {
              // doing nothing in the evaluator
              return;
            };

            const p1 = bus.scan({
              evaluator,
              trigger: '*'
            });

            const p2 = bus.scan({
              evaluator,
              trigger: '*'
            });

            expect((p1 as any)[INTERNAL_PROMISE] === (p2 as any)[INTERNAL_PROMISE]).toBeTrue();
          });
        });
      });

      describe('given a pooled scanner is settled', () => {
        describe('and another scan is invoked with the same parameters that created the pooled scanner', () => {
          it('a new pooled scanner is created', async () => {
            let criteria: boolean = false;
            const evaluator = (resolve: Scanner.Resolver<boolean>) => {
              if(criteria) {
                resolve(criteria);
              }
            };

            const p1 = bus.scan({
              evaluator,
              trigger: 'foo'
            });

            criteria = true;
            bus.emit('foo', null);

            await p1;

            const p2 = bus.scan({
              evaluator,
              trigger: 'foo'
            });

            expect((p1 as any)[INTERNAL_PROMISE] === (p2 as any)[INTERNAL_PROMISE]).toBeFalse();
          });
        });
      });

      describe('given an scan invocation is canceled', () => {
        it('only rejects the canceled invocation, not all scans in the pool', async () => {
          let criteria: boolean = false;
          const evaluator = (resolve: Scanner.Resolver<boolean>) => {
            if(criteria) {
              resolve(criteria);
            }
          };

          const resolveSpy = jasmine.createSpy('resolve');
          const rejectSpy = jasmine.createSpy('reject');

          const p1 = bus.scan({
            evaluator,
            trigger: '*'
          });
          p1.then(resolveSpy);

          const p2 = bus.scan({
            evaluator,
            trigger: '*'
          });
          p2.catch(rejectSpy);

          p2.cancel('test');
          criteria = true;
          bus.emit('foo', null);

          await parallel([p1, p2]);

          expect(resolveSpy).toHaveBeenCalledWith(true);
          expect(rejectSpy).toHaveBeenCalledWith('test');

        });
      });

      describe('given params.pool=false', () => {
        it('does not return the same promise object', () => {
          const evaluator = (resolve: Scanner.Resolver<boolean>, reject: Scanner.Rejecter) => {
            // doing nothing in the evaluator
            return;
          };

          const p1 = bus.scan({
            evaluator,
            trigger: '*',
            pool: false
          });

          const p2 = bus.scan({
            evaluator,
            trigger: '*'
          });

          expect((p1 as any)[INTERNAL_PROMISE] === (p2 as any)[INTERNAL_PROMISE]).toBeFalse();
        });
      });
    });

    describe('Scanner teardown (unpooled)', () => {
      let s: CancelablePromise<any>;
      let spy: jasmine.Spy;
      let condition: 'success'|'failure';

      beforeEach(() => {
        condition = undefined;
        spy = jasmine.createSpy('evaluator');
        s = bus.scan({
          trigger: 'foo',
          evaluator: (resolve, reject) => {
            spy();
            if(condition === 'success') {
              resolve(null);
            } else if(condition === 'failure') {
              reject();
            }
          },
          eager: true
        });
      });

      describe('given a Scanner has resolved', () => {
        describe('and the trigger event is emitted again', () => {
          it('does not invoke the evaluator again', async () => {
            expect(spy).toHaveBeenCalledTimes(1);  // eager
            await expectAsync(s).toBePending();
            condition = 'success';
            bus.emit('foo', null);
            await expectAsync(s).toBeResolved();
            expect(spy).withContext('when resolved').toHaveBeenCalledTimes(2);
            // trigger event again
            bus.emit('foo', null);
            await sleep(1);
            expect(spy).withContext('event triggered later').toHaveBeenCalledTimes(2);
          });
        });

        describe('and the scannable is destroyed', () => {
          it('does not invoke the evaluator again', async () => {
            expect(spy).toHaveBeenCalledTimes(1); // eager
            await expectAsync(s).toBePending();
            condition = 'success';
            bus.emit('foo', null);
            await expectAsync(s).toBeResolved();
            expect(spy).withContext('when resolved').toHaveBeenCalledTimes(2);

            bus.destroy();
            await sleep(1);
            expect(spy).withContext('once destroyed').toHaveBeenCalledTimes(2);
          });
        });

        describe('and the scanner is canceled', () => {
          it('does not invoke the evaluator again', async () => {
            expect(spy).toHaveBeenCalledTimes(1);  // eager
            await expectAsync(s).toBePending();
            condition = 'success';
            bus.emit('foo', null);
            await expectAsync(s).toBeResolved();
            expect(spy).withContext('when resolved').toHaveBeenCalledTimes(2);

            s.cancel();
            await sleep(1);
            expect(spy).withContext('event triggered later').toHaveBeenCalledTimes(2);
          });
        });
      });

      describe('given a Scanner has rejected', () => {
        describe('and the trigger event is emitted again', () => {
          it('does not invoke the evaluator again', async() => {
            expect(spy).toHaveBeenCalledTimes(1); // eager
            await expectAsync(s).toBePending();
            condition = 'failure';
            bus.emit('foo', null);
            await expectAsync(s).toBeRejected();
            expect(spy).withContext('when rejected').toHaveBeenCalledTimes(2);
            // trigger event again
            bus.emit('foo', null);
            await sleep(1);
            expect(spy).withContext('event triggered later').toHaveBeenCalledTimes(2);
          });
        });

        describe('and the scannable is destroyed', () => {
          it('does not invoke the evaluator again', async () => {
            expect(spy).toHaveBeenCalledTimes(1); // eager
            await expectAsync(s).toBePending();
            condition = 'failure';
            bus.emit('foo', null);
            await expectAsync(s).toBeRejected();
            expect(spy).withContext('when rejected').toHaveBeenCalledTimes(2);

            bus.destroy();
            await sleep(1);
            expect(spy).withContext('once destroyed').toHaveBeenCalledTimes(2);
          });
        });

        describe('and the scanner is canceled', () => {
          it('does not invoke the evaluator again', async() => {
            expect(spy).toHaveBeenCalledTimes(1); // eager
            await expectAsync(s).toBePending();
            condition = 'failure';
            bus.emit('foo', null);
            await expectAsync(s).toBeRejected();
            expect(spy).withContext('when rejected').toHaveBeenCalledTimes(2);

            s.cancel();
            await sleep(1);
            expect(spy).withContext('event triggered later').toHaveBeenCalledTimes(2);
          });
        });
      });

      describe('given the Scanner is canceled while still pending', () => {
        describe('and the trigger event is emitted again', () => {
          it('does not invoke the evaluator again', async () => {
            expect(spy).toHaveBeenCalledTimes(1); // eager
            await expectAsync(s).toBePending();
            bus.emit('foo', null);
            await expectAsync(s).toBePending();
            expect(spy).withContext('after event').toHaveBeenCalledTimes(2);

            s.cancel();
            await expectAsync(s).toBeRejected();
            expect(spy).withContext('after cancel').toHaveBeenCalledTimes(2);

            bus.emit('foo', null);
            await sleep(1);
            expect(spy).withContext('event triggered later').toHaveBeenCalledTimes(2);
          });
        });

        describe('and the scannable is destroyed', () => {
          it('does not invoke the evaluator again', async () => {
            expect(spy).toHaveBeenCalledTimes(1); // eager
            await expectAsync(s).toBePending();
            bus.emit('foo', null);
            await expectAsync(s).toBePending();
            expect(spy).withContext('after event').toHaveBeenCalledTimes(2);

            s.cancel();
            await expectAsync(s).toBeRejected();
            expect(spy).withContext('after cancel').toHaveBeenCalledTimes(2);

            bus.destroy();
            await sleep(1);
            expect(spy).withContext('once destroyed').toHaveBeenCalledTimes(2);
          });
        });
      });
    });

    describe('Scanner teardown (pooled)', () => {
      describe('given one of the scanners is canceled', () => {
        let condition: 'success'|'failure';
        let spy: jasmine.Spy;
        let evaluator: (resolve: Scanner.Resolver<boolean>, reject: Scanner.Rejecter) => void;
        let p1: CancelablePromise<any>;
        let p2: CancelablePromise<any>;

        beforeEach(() => {
          condition = undefined;
          spy = jasmine.createSpy('evaluator');
          evaluator = (resolve: Scanner.Resolver<boolean>, reject: Scanner.Rejecter) => {
            spy();
            if(condition === 'success') {
              resolve(true);
            } else if (condition === 'failure') {
              reject();
            }
          };
          p1 = bus.scan({
            evaluator,
            trigger: 'foo'
          });
          p2 = bus.scan({
            evaluator,
            trigger: 'foo'
          });
        });

        it('does not cancel the other scanner', async() => {
          await expectAsync(p1).toBePending();
          await expectAsync(p2).toBePending();
          expect(spy).toHaveBeenCalledTimes(1); // eager

          p1.cancel();

          await expectAsync(p1).toBeRejected();
          await expectAsync(p2).toBePending();
        });

        describe('given a triggering event is emitted from the Scannable', () => {
          it('still invokes the evaluator', async () => {
            await expectAsync(p1).toBePending();
            await expectAsync(p2).toBePending();
            expect(spy).toHaveBeenCalledTimes(1); // eager

            p1.cancel();

            await expectAsync(p1).toBeRejected();
            await expectAsync(p2).toBePending();

            bus.emit('foo', null);
            await sleep(1);
            expect(spy).toHaveBeenCalledTimes(2);
          });
        });

        describe('given the Scannable is destroyed while the uncanceled scanner is still pending', () => {
          it('still invokes the evaluator', async () => {
            await expectAsync(p1).toBePending();
            await expectAsync(p2).toBePending();
            expect(spy).toHaveBeenCalledTimes(1); // eager

            p1.cancel();

            await expectAsync(p1).toBeRejected();
            await expectAsync(p2).toBePending();

            bus.destroy();
            await sleep(1);
            expect(spy).toHaveBeenCalledTimes(2);
          });
        });

        describe('given the evaluator is resolved', () => {
          it('resolves the uncanceled scanner', async () => {
            await expectAsync(p1).toBePending();
            await expectAsync(p2).toBePending();
            expect(spy).toHaveBeenCalledTimes(1); // eager

            p1.cancel();

            await expectAsync(p1).toBeRejected();
            await expectAsync(p2).toBePending();

            condition = 'success';
            bus.emit('foo', null);
            await expectAsync(p1).toBeRejected();
            await expectAsync(p2).toBeResolved();
            expect(spy).toHaveBeenCalledTimes(2);
          });

          describe('and a triggering event is subsequently emitted from the Scannable', () => {
            it('does not invoke the evaluator again', async () => {
              await expectAsync(p1).toBePending();
              await expectAsync(p2).toBePending();
              expect(spy).toHaveBeenCalledTimes(1); // eager

              p1.cancel();

              await expectAsync(p1).toBeRejected();
              await expectAsync(p2).toBePending();

              condition = 'success';
              bus.emit('foo', null);
              await expectAsync(p1).toBeRejected();
              await expectAsync(p2).toBeResolved();
              expect(spy).toHaveBeenCalledTimes(2);

              bus.emit('foo', null);
              await sleep(1);
              expect(spy).toHaveBeenCalledTimes(2);
            });
          });

          describe('and the Scannable is subsequently destroyed', () => {
            it('does not invoke the evaluator again', async () => {
              await expectAsync(p1).toBePending();
              await expectAsync(p2).toBePending();
              expect(spy).toHaveBeenCalledTimes(1); // eager

              p1.cancel();

              await expectAsync(p1).toBeRejected();
              await expectAsync(p2).toBePending();

              condition = 'success';
              bus.emit('foo', null);
              await expectAsync(p1).toBeRejected();
              await expectAsync(p2).toBeResolved();
              expect(spy).toHaveBeenCalledTimes(2);

              bus.destroy();
              await sleep(1);
              expect(spy).toHaveBeenCalledTimes(2);
            });
          });
        });

        describe('given the evaluator is rejected', () => {
          it('rejects the uncanceled scanner', async () => {
            await expectAsync(p1).toBePending();
            await expectAsync(p2).toBePending();
            expect(spy).toHaveBeenCalledTimes(1); // eager

            p1.cancel();

            await expectAsync(p1).toBeRejected();
            await expectAsync(p2).toBePending();

            condition = 'failure';
            bus.emit('foo', null);
            await expectAsync(p1).toBeRejected();
            await expectAsync(p2).toBeRejected();
            expect(spy).toHaveBeenCalledTimes(2);
          });

          describe('and a triggering event is subsequently emitted from the Scannable', () => {
            it('does not invoke the evaluator again', async () => {
              await expectAsync(p1).toBePending();
              await expectAsync(p2).toBePending();
              expect(spy).toHaveBeenCalledTimes(1); // eager

              p1.cancel();

              await expectAsync(p1).toBeRejected();
              await expectAsync(p2).toBePending();

              condition = 'failure';
              bus.emit('foo', null);
              await expectAsync(p1).toBeRejected();
              await expectAsync(p2).toBeRejected();
              expect(spy).toHaveBeenCalledTimes(2);

              bus.emit('foo', null);
              await sleep(1);
              expect(spy).toHaveBeenCalledTimes(2);
            });
          });

          describe('and the Scannable is subsequently destroyed', () => {
            it('does not invoke the evaluator again', async () => {
              await expectAsync(p1).toBePending();
              await expectAsync(p2).toBePending();
              expect(spy).toHaveBeenCalledTimes(1); // eager

              p1.cancel();

              await expectAsync(p1).toBeRejected();
              await expectAsync(p2).toBePending();

              condition = 'failure';
              bus.emit('foo', null);
              await expectAsync(p1).toBeRejected();
              await expectAsync(p2).toBeRejected();
              expect(spy).toHaveBeenCalledTimes(2);

              bus.destroy();
              await sleep(1);
              expect(spy).toHaveBeenCalledTimes(2);
            });
          });
        });
      });
    });

    describe('given params.timeout is configured', () => {
      describe('and its value is 0', () => {
        describe('given pooling is configured', () => {
          it('pooling is used (timeout is ignored)', () => {
            const evaluator = (resolve: Scanner.Resolver<boolean>, reject: Scanner.Rejecter) => {
              // doing nothing in the evaluator
              return;
            };

            const p1 = bus.scan({
              evaluator,
              trigger: 'foo',
              timeout: 0
            });
            const p2 = bus.scan({
              evaluator,
              trigger: 'foo'
            });

            expect((p1 as any)[INTERNAL_PROMISE] === (p2 as any)[INTERNAL_PROMISE]).toBeTrue();
          });
        });
      });

      describe('and its value is < 0', () => {
        describe('given pooling is configured', () => {
          it('pooling is used (timeout is ignored)', () => {
            const evaluator = (resolve: Scanner.Resolver<boolean>, reject: Scanner.Rejecter) => {
              // doing nothing in the evaluator
              return;
            };

            const p1 = bus.scan({
              evaluator,
              trigger: 'foo',
              timeout: -1
            });
            const p2 = bus.scan({
              evaluator,
              trigger: 'foo'
            });

            expect((p1 as any)[INTERNAL_PROMISE] === (p2 as any)[INTERNAL_PROMISE]).toBeTrue();
          });
        });
      });

      describe('and its value is > 0', () => {
        it('the scan is canceled after `params.timeout` ms', (done) => {
          const evaluator = (resolve: Scanner.Resolver<boolean>, reject: Scanner.Rejecter) => {
            // doing nothing in the evaluator
            return;
          };

          const p1 = bus.scan({
            evaluator,
            trigger: 'foo',
            timeout: 100
          });
          expect(bus.getListenerCountFor('foo')).toBeGreaterThan(0);

          p1.then(() => done.fail())
          .catch((e) => {
            expect(e).toBeInstanceOf(TimeoutExpiredError);
            expect(bus.getListenerCountFor('foo')).toBe(0);
            done();
          });
        });

        describe('given pooling is configured', () => {
          it('it does not pool the scanners', () => {
            const evaluator = (resolve: Scanner.Resolver<boolean>, reject: Scanner.Rejecter) => {
              // doing nothing in the evaluator
              return;
            };

            const p1 = bus.scan({
              evaluator,
              trigger: 'foo',
              timeout: 100
            });
            const p2 = bus.scan({
              evaluator,
              trigger: 'foo',
              timeout: 100
            });

            expect((p1 as any)[INTERNAL_PROMISE] === (p2 as any)[INTERNAL_PROMISE]).toBeFalse();

            p1.catch((e: unknown): void => null);
            p2.catch((e: unknown): void => null);

            p1.cancel();
            p2.cancel();
          });
        });
      });
    });
  });
});

function combinedListenersToMap(bus: Strongbus.Bus<TestEventMap>): Map<string | number | symbol, Set<unknown>> {
  const map = new Map<string | number | symbol, Set<unknown>>();
  bus.forEach((event, handlers) => {
    map.set(event, new Set(handlers));
  });
  return map;
}

function ownListenersToMap(bus: Strongbus.Bus<TestEventMap>): Map<string | number | symbol, Set<unknown>> {
  const map = new Map<string | number | symbol, Set<unknown>>();
  bus.forEach((event, handlers) => {
    map.set(event, new Set(handlers));
  }, {scope: Strongbus.ListenerScope.OWN});
  return map;
}

function combinedListenerEvents(bus: Strongbus.Bus<TestEventMap>): string[] {
  const keys: string[] = [];
  bus.forEach((event) => keys.push(String(event)));
  return keys;
}