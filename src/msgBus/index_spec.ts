import MsgBus, {Event, EventSubscription, MsgBusOptions} from './';
import * as EventEmitter from 'eventemitter3';

describe('abstract class MsgBus', () => {
  class MockImplementation extends MsgBus<any> {
    private emulateListenerCount: boolean;
    constructor(options?: MsgBusOptions & {emulateListenerCount?: boolean}) {
      super(options);
      this.emulateListenerCount = (options || {emulateListenerCount: false}).emulateListenerCount;
    }

    // pass thru to instance's internal bus
    public on(event: Event|Event[], handler: EventEmitter.ListenerFn): EventSubscription {
      this.bus.on(event as Event, handler);
      return function() {} as EventSubscription;
    }

    // just pass thru the event to the intstance's internal bus
    public emit(event: Event, ...args: any[]): boolean {
      this.bus.emit(event, ...args);
      return this.emulateListenerCount;
    }

    protected handleUnexpectedEvent(event: Event, ...args: any[]): void {}
  }

  let msgBus: MockImplementation, onTestEvent, onAnyEvent, onEveryEvent, bus: EventEmitter;

  beforeEach(() => {
    msgBus = new MockImplementation();
    onTestEvent = jasmine.createSpy('onTestEvent');
    onAnyEvent = jasmine.createSpy('onAnyEvent');
    onEveryEvent = jasmine.createSpy('onEveryEvent');
    spyOn(msgBus as any, 'handleUnexpectedEvent');
    bus = (msgBus as any).bus;
  });

  describe('#constructor', () => {
    it('overloads the instance\'s internal emitter\'s emit method to invoke * listeners on any event raised', () => {
      msgBus.on('testEvent', onTestEvent);
      msgBus.on('*', onAnyEvent);

      msgBus.emit('testEvent', 'eagle', 1);
      expect(onTestEvent).toHaveBeenCalledWith('eagle', 1);
      expect(onAnyEvent).toHaveBeenCalledWith('eagle', 1);
    });

    describe('given an un-handled event is raised', () => {
      describe('and given the `allowUnhandledEvent` option is false', () => {
        it('invokes instance\'s #handleUnexpectedEvent method', () => {
          msgBus = new MockImplementation({allowUnhandledEvents: false});
          spyOn(msgBus as any, 'handleUnexpectedEvent');
          msgBus.emit('randomEvent', 'oops', 'nope');

          expect((msgBus as any).handleUnexpectedEvent).toHaveBeenCalledWith('randomEvent', 'oops', 'nope');
        });
      });
      describe('and given the `allowUnhandledEvent` option is true (default)', () => {
        it('does not invoke instance\'s #handleUnexpectedEvent method', () => {
          msgBus.emit('randomEvent', 'oops', 'nope');

          expect((msgBus as any).handleUnexpectedEvent).not.toHaveBeenCalled();
        });
      });
    });
  });

  describe('#any', () => {
    it('adds the same listener for each event given, and the listener receives the event as arg[0]', () => {
      msgBus.any(['baboon', 'giraffe'], onAnyEvent);
      msgBus.emit('baboon', 'sandwich');

      expect(onAnyEvent).toHaveBeenCalledWith('baboon', 'sandwich');

      msgBus.emit('giraffe', 'attack');
      expect(onAnyEvent).toHaveBeenCalledWith('giraffe', 'attack');
    });

    it('returns an unsubscribe function that removes the listener', () => {
      msgBus = new MockImplementation({allowUnhandledEvents: false});
      spyOn(msgBus as any, 'handleUnexpectedEvent');

      const unsub = msgBus.any(['baboon', 'raccoon'], onAnyEvent);
      msgBus.emit('baboon');
      expect(onAnyEvent).toHaveBeenCalledTimes(1);
      expect((msgBus as any).handleUnexpectedEvent).not.toHaveBeenCalled();

      unsub();
      msgBus.emit('baboon');
      expect(onAnyEvent).toHaveBeenCalledTimes(1);
      expect((msgBus as any).handleUnexpectedEvent).toHaveBeenCalledWith('baboon');
      (msgBus as any).handleUnexpectedEvent.calls.reset();

      msgBus.emit('raccoon');
      expect(onAnyEvent).toHaveBeenCalledTimes(1);
      expect((msgBus as any).handleUnexpectedEvent).toHaveBeenCalledWith('raccoon');
    });
  });

  describe('#every', () => {
    it('adds a single listener for all events, and the listener receives only the payload', () => {
      msgBus.every(onEveryEvent);

      msgBus.emit('testEvent');
      expect(onEveryEvent).toHaveBeenCalledTimes(1);

      msgBus.emit('testEvent2');
      expect(onEveryEvent).toHaveBeenCalledTimes(2);
    });
  });

  describe('#pipe', () => {
    let msgBus2: MockImplementation, msgBus3: MockImplementation;

    beforeEach(() => {
      msgBus2 = new MockImplementation({emulateListenerCount: true});
    });

    describe('given an event is raised from the parent bus', () => {
      it('handles the event on the parent bus AND the delegate msgBus', () => {
        spyOn(msgBus2, 'emit');
        msgBus.pipe(msgBus2);

        msgBus.on('testEvent', onTestEvent);
        msgBus.emit('testEvent', 'wow!');

        expect(onTestEvent).toHaveBeenCalledWith('wow!');
        expect(msgBus2.emit).toHaveBeenCalledWith('testEvent', 'wow!');
      });
    });

    it('counts piped listeners as handlers when events are raised', () => {
      msgBus = new MockImplementation({allowUnhandledEvents: false});
      spyOn(msgBus as any, 'handleUnexpectedEvent');
      msgBus.emit('testEvent');
      expect((msgBus as any).handleUnexpectedEvent).toHaveBeenCalled();
      (msgBus as any).handleUnexpectedEvent.calls.reset();

      msgBus.pipe(msgBus2);
      msgBus.emit('testEvent');
      expect((msgBus as any).handleUnexpectedEvent).not.toHaveBeenCalled();
      msgBus.unpipe(msgBus2);

      // removed the delegate, msgBus has no listeners again
      msgBus.emit('testEvent');
      expect((msgBus as any).handleUnexpectedEvent).toHaveBeenCalled();
      (msgBus as any).handleUnexpectedEvent.calls.reset();

      // emulate a delegate bus with no listeners attached
      msgBus3 = new MockImplementation({emulateListenerCount: false});
      msgBus.pipe(msgBus3);

      msgBus.emit('testEvent');
      expect((msgBus as any).handleUnexpectedEvent).toHaveBeenCalled();
    });

    it('bubbles unhandled events to the parent regardless of whether the delegate allows them', () => {
      msgBus = new MockImplementation({allowUnhandledEvents: false});
      msgBus2 = new MockImplementation({allowUnhandledEvents: true});
      msgBus3 = new MockImplementation({allowUnhandledEvents: false, emulateListenerCount: false});
      spyOn(msgBus as any, 'handleUnexpectedEvent');
      spyOn(msgBus2 as any, 'handleUnexpectedEvent');
      spyOn(msgBus3 as any, 'handleUnexpectedEvent');

      msgBus.pipe(msgBus2);
      msgBus.pipe(msgBus3);
      msgBus.emit('testEvent');
      expect((msgBus3 as any).handleUnexpectedEvent).toHaveBeenCalled();
      expect((msgBus2 as any).handleUnexpectedEvent).not.toHaveBeenCalled();
      expect((msgBus as any).handleUnexpectedEvent).toHaveBeenCalled();
    });

    it('can be chained', () => {
      msgBus2 = new MockImplementation();
      msgBus3 = new MockImplementation();

      spyOn(msgBus2, 'emit').and.callThrough();
      spyOn(msgBus3, 'emit');

      msgBus.pipe(msgBus2).pipe(msgBus3);

      msgBus.emit('testEvent', 'woot');
      expect(msgBus2.emit).toHaveBeenCalledWith('testEvent', 'woot');
      expect(msgBus3.emit).toHaveBeenCalledWith('testEvent', 'woot');
    });
  });

  describe('#unpipe', () => {
    let msgBus2: MockImplementation, msgBus3: MockImplementation;

    beforeEach(() => {
      msgBus2 = new MockImplementation({emulateListenerCount: true});
    });

    it('removes a piped msg bus', () => {
      spyOn(msgBus2, 'emit');
      msgBus.pipe(msgBus2);

      msgBus.emit('testEvent', 'wow!');

      expect(msgBus2.emit).toHaveBeenCalledWith('testEvent', 'wow!');
      (msgBus2.emit as any).calls.reset();

      msgBus.unpipe(msgBus2);

      msgBus.emit('testEvent', 'wow!');
      expect(msgBus2.emit).not.toHaveBeenCalled();
    });

    it('breaks the a chain of piped buses', () => {
      msgBus3 = new MockImplementation();
      spyOn(msgBus2, 'emit').and.callThrough();
      spyOn(msgBus3, 'emit').and.callThrough();

      msgBus.pipe(msgBus2).pipe(msgBus3);
      msgBus.emit('testEvent');

      expect(msgBus2.emit).toHaveBeenCalledWith('testEvent');
      expect(msgBus3.emit).toHaveBeenCalledWith('testEvent');
      (msgBus2.emit as any).calls.reset();
      (msgBus3.emit as any).calls.reset();

      msgBus.unpipe(msgBus2);
      msgBus.emit('testEvent');
      expect(msgBus2.emit).not.toHaveBeenCalledWith('testEvent');
      expect(msgBus3.emit).not.toHaveBeenCalledWith('testEvent');

      msgBus2.emit('testEvent');
      expect(msgBus3.emit).toHaveBeenCalledWith('testEvent');
    });
  });

  describe('#proxy', () => {
    it('adds a proxy handler for raised events that receives the event as well as the payload', () => {
      const proxy = jasmine.createSpy('proxy');
      msgBus.on('testEvent', onTestEvent);
      msgBus.every(onEveryEvent);
      msgBus.proxy(proxy);

      msgBus.emit('testEvent', 1, 'hat', true);
      expect(onTestEvent).toHaveBeenCalledWith(1, 'hat', true);
      expect(onEveryEvent).toHaveBeenCalledWith(1, 'hat', true);
      expect(proxy).toHaveBeenCalledWith('testEvent', 1, 'hat', true);
      expect(proxy).toHaveBeenCalledTimes(1);
    });
  });

  describe('#hook', () => {
    let onWillAddListener, onWillRemoveListener, onAddListener, onRemoveListener;
    let onWillActivate, onActive, onWillIdle, onIdle;

    beforeEach(() => {
      msgBus.hook('willAddListener', onWillAddListener = jasmine.createSpy('onWillAddListener'));
      msgBus.hook('didAddListener', onAddListener = jasmine.createSpy('onAddListener'));
      msgBus.hook('willRemoveListener', onWillRemoveListener = jasmine.createSpy('onWillRemoveListener'));
      msgBus.hook('didRemoveListener', onRemoveListener = jasmine.createSpy('onRemoveListener'));
      msgBus.hook('willActivate', onWillActivate = jasmine.createSpy('onWillActivate'));
      msgBus.hook('active', onActive = jasmine.createSpy('onActive'));
      msgBus.hook('willIdle', onWillIdle = jasmine.createSpy('onWillIdle'));
      msgBus.hook('idle', onIdle = jasmine.createSpy('onIdle'));
    });

    it('allows subscription to meta events', () => {
      msgBus.on('testEvent', onTestEvent);
      expect(onWillAddListener).toHaveBeenCalledWith('testEvent');
      expect(onAddListener).toHaveBeenCalledWith('testEvent');
      expect(onWillActivate).toHaveBeenCalled();
      expect(onActive).toHaveBeenCalled();

      bus.removeListener('testEvent', onTestEvent);
      expect(onWillRemoveListener).toHaveBeenCalledWith('testEvent');
      expect(onRemoveListener).toHaveBeenCalledWith('testEvent');
      expect(onIdle).toHaveBeenCalled();
    });

    it('only raises "willActivate" and "active" events when the MsgBus goes from 0 to 1 listeners', () => {
      expect(msgBus.hasListeners).toBeFalsy();
      msgBus.on('testEvent', onTestEvent);
      expect(onWillActivate).toHaveBeenCalled();
      expect(onActive).toHaveBeenCalledTimes(1);
      expect(msgBus.hasListeners).toBeTruthy();

      msgBus.on('testEvent2', onTestEvent);
      expect(onWillActivate).toHaveBeenCalledTimes(1);
      expect(onActive).toHaveBeenCalledTimes(1);
    });

    it('only raises "willIdle" and "idle" events when the MsgBus goes from 1 to 0 listeners', () => {
      expect(msgBus.hasListeners).toBeFalsy();
      msgBus.on('testEvent', onTestEvent);
      msgBus.on('testEvent2', onTestEvent);
      expect(onWillIdle).toHaveBeenCalledTimes(0);
      expect(onIdle).toHaveBeenCalledTimes(0);

      bus.removeListener('testEvent2', onTestEvent);
      expect(onWillIdle).toHaveBeenCalledTimes(0);
      expect(onIdle).toHaveBeenCalledTimes(0);
      bus.removeListener('testEvent', onTestEvent);
      expect(onWillIdle).toHaveBeenCalledTimes(1);
      expect(onIdle).toHaveBeenCalledTimes(1);

      bus.removeListener('testEvent', onTestEvent);
      expect(onWillIdle).toHaveBeenCalledTimes(1);
      expect(onIdle).toHaveBeenCalledTimes(1);
    });

    describe('given MsgBus has delegates', () => {
      let msgBus2: MockImplementation,
        onDelegateWillAddListener,
        onDelegateDidAddListener,
        onDelegateWillRemoveListener,
        onDelegateDidRemoveListener,
        onDelegateWillActivate,
        onDelegateActive,
        onDelegateWillIdle,
        onDelegateIdle;

      beforeEach(() => {
        msgBus2 = new MockImplementation();
        msgBus.pipe(msgBus2);

        msgBus2.hook('willAddListener', onDelegateWillAddListener = jasmine.createSpy('onDelegateWillAddListener'));
        msgBus2.hook('didAddListener', onDelegateDidAddListener = jasmine.createSpy('onDelegateDidAddListener'));
        msgBus2.hook('willRemoveListener', onDelegateWillRemoveListener = jasmine.createSpy('onDelegateWillRemoveListener'));
        msgBus2.hook('didRemoveListener', onDelegateDidRemoveListener = jasmine.createSpy('onDelegateDidRemoveListener'));
        msgBus2.hook('willActivate', onDelegateWillActivate = jasmine.createSpy('onDelegateWillActivate'));
        msgBus2.hook('active', onDelegateActive = jasmine.createSpy('onDelegateActive'));
        msgBus2.hook('willIdle', onDelegateWillIdle = jasmine.createSpy('onDelegateWillIdle'));
        msgBus2.hook('idle', onDelegateIdle = jasmine.createSpy('onDelegateIdle'));
      });

      it('bubbles events from delegates', () => {
        (msgBus2 as any).bus.on('testEvent', onTestEvent);
        expect(onDelegateWillAddListener).toHaveBeenCalledWith('testEvent');
        expect(onWillAddListener).toHaveBeenCalledWith('testEvent');

        expect(onDelegateDidAddListener).toHaveBeenCalledWith('testEvent');
        expect(onAddListener).toHaveBeenCalledWith('testEvent');

        expect(onDelegateWillActivate).toHaveBeenCalled();
        expect(onWillActivate).toHaveBeenCalled();

        expect(onDelegateActive).toHaveBeenCalled();
        expect(onActive).toHaveBeenCalled();


        (msgBus2 as any).bus.removeListener('testEvent', onTestEvent);
        expect(onDelegateWillRemoveListener).toHaveBeenCalledWith('testEvent');
        expect(onRemoveListener).toHaveBeenCalledWith('testEvent');

        expect(onDelegateDidRemoveListener).toHaveBeenCalledWith('testEvent');
        expect(onRemoveListener).toHaveBeenCalledWith('testEvent');

        expect(onDelegateWillIdle).toHaveBeenCalled();
        expect(onWillIdle).toHaveBeenCalled();

        expect(onDelegateIdle).toHaveBeenCalled();
        expect(onIdle).toHaveBeenCalled();
      });


      it('raises "active" events independently of delegates', () => {
        msgBus.on('testEvent', onTestEvent);
        expect(onActive).toHaveBeenCalledTimes(1);
        (msgBus2 as any).bus.on('testEvent', onTestEvent);
        expect(onDelegateActive).toHaveBeenCalledTimes(1);
        expect(onActive).toHaveBeenCalledTimes(1);
      });

      it('raises "idle" events independently of delegates', () => {
        msgBus.on('testEvent', onTestEvent);
        (msgBus2 as any).bus.on('testEvent', onTestEvent);

        (msgBus2 as any).bus.removeListener('testEvent', onTestEvent);
        expect(onDelegateIdle).toHaveBeenCalledTimes(1);
        expect(onIdle).toHaveBeenCalledTimes(0);

        bus.removeListener('testEvent', onTestEvent);
        expect(onDelegateIdle).toHaveBeenCalledTimes(1);
        expect(onIdle).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('#monitor', () => {
    let handleActiveChange;

    beforeEach(() => {
      msgBus.monitor(handleActiveChange = jasmine.createSpy('handleActiveChange'));
    });

    describe('given the MsgBus goes from 0 to 1 listeners', () => {
      it('invokes a callback with `true`', () => {
        msgBus.on('testEvent', onTestEvent);
        expect(handleActiveChange).toHaveBeenCalledWith(true);
      });
    });

    describe('given the MsgBus goes from 1 to 0 listeners', () => {
      it('invokes a callback with `false`', () => {
        msgBus.on('testEvent', onTestEvent);
        expect(handleActiveChange).toHaveBeenCalledWith(true);
        bus.removeListener('testEvent', onTestEvent);
        expect(handleActiveChange).toHaveBeenCalledWith(false);
      });
    });
  });

  describe('#hasListeners', () => {
    describe('given there are any event listeners on the instance', () => {
      it('returns true', () => {
        msgBus.every(onEveryEvent);
        expect(msgBus.hasListeners).toBeTruthy();
      });
    });

    describe('given there are no listeners registered with the instance', () => {
      it('returns false', () => {
        expect(msgBus.hasListeners).toBeFalsy();
      });
    });
  });

  describe('#listeners', () => {
    let msgBus2: MockImplementation;

    beforeEach(() => {
      msgBus2 = new MockImplementation({emulateListenerCount: true});
    });

    describe('given there are event listeners on the instance', () => {
      beforeEach(() => {
        msgBus.on('testEvent', onTestEvent);
      });

      describe('and there are no delegate listeners', () => {
        it('lists the listeners on the instance', () => {
          expect(msgBus.listeners).toEqual({
            testEvent: [onTestEvent]
          });
          msgBus.on('*', onAnyEvent);
          expect(msgBus.listeners).toEqual({
            testEvent: [onTestEvent],
            '*': [onAnyEvent]
          });
        });
      });

      describe('and the instance has delegates with no listeners', () => {
        it("lists the instance's listeners", () => {
          msgBus.pipe(msgBus2);
          expect(msgBus.listeners).toEqual({
            testEvent: [onTestEvent]
          });
        });
      });

      describe('and the instance has delegates with listeners', () => {
        it("lists the instance's listeners and the delegate listeners", () => {
          msgBus.pipe(msgBus2);
          msgBus2.on('testEvent', onAnyEvent);
          expect(msgBus.listeners).toEqual({
            testEvent: [onTestEvent, onAnyEvent]
          });
        });
      });
    });

    describe('given there are no event listeners on the instance', () => {
      describe('and the instance has delegates with listeners', () => {
        it('lists the delegate listeners', () => {
          msgBus.pipe(msgBus2);
          msgBus2.on('testEvent', onAnyEvent);
          expect(msgBus.listeners).toEqual({
            testEvent: [onAnyEvent]
          });
        });
      });

      describe('and the instance has delegates with no listeners', () => {
        it('returns an empty object', () => {
          msgBus.pipe(msgBus2);
          expect(msgBus.listeners).toEqual({});
        });
      });

      describe('and the instance has no delegates', () => {
        it('returns an empty object', () => {
          expect(msgBus.listeners).toEqual({});
        });
      });
    });
  });

  describe('#destroy', () => {
    it('removes all event listeners', () => {
      msgBus = new MockImplementation({allowUnhandledEvents: false});
      spyOn(msgBus as any, 'handleUnexpectedEvent');
      msgBus.on('testEvent', onTestEvent);
      msgBus.every(onEveryEvent);

      msgBus.emit('testEvent');
      expect(onTestEvent).toHaveBeenCalled();
      expect(onEveryEvent).toHaveBeenCalled();

      msgBus.destroy();
      msgBus.emit('testEvent');
      expect((msgBus as any).handleUnexpectedEvent).toHaveBeenCalled();
    });

    it('removes all hooks', () => {
      const onAddListener = jasmine.createSpy('onAddListener');
      msgBus.hook('didAddListener', onAddListener);
      msgBus.on('testEvent', onTestEvent);
      expect(onAddListener).toHaveBeenCalledWith('testEvent');
      onAddListener.calls.reset();

      msgBus.destroy();
      msgBus.on('testEvent', onTestEvent);
      expect(onAddListener).not.toHaveBeenCalled();
    });

    it('clears all delegates', () => {
      const msgBus2 = new MockImplementation();
      spyOn(msgBus2, 'emit');

      msgBus.pipe(msgBus2);

      msgBus.emit('testEvent');
      expect(msgBus2.emit).toHaveBeenCalled();
      (msgBus2.emit as any).calls.reset();

      msgBus.destroy();
      msgBus.emit('testEvent');
      expect(msgBus2.emit).not.toHaveBeenCalled();
    });
  });

  describe('Reserved events', () => {
    describe('given the * event is manually raised', () => {
      it('throws an error', () => {
        msgBus.on('*', onAnyEvent);
        const shouldThrow = () => msgBus.emit('*', 'eagle', 1);

        expect(shouldThrow).toThrow();
      });
    });

    describe('given the @@PROXY@@ event is manually raised', () => {
      it('throws an error', () => {
        msgBus.on('@@PROXY@@', onAnyEvent);
        const shouldThrow = () => msgBus.emit('@@PROXY@@', 'eagle', 1);

        expect(shouldThrow).toThrow();
      });
    });
  });
});
