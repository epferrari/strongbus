import {sleep} from 'jaasync/lib/cancelable';

import * as Strongbus from './';
import {Scanner} from './scanner';
import {EventKeys} from './types/utility';

type TestEventMap = {
  foo: string;
  bar: boolean;
  baz: number;
};

class DelegateTestBus<T extends object = TestEventMap> extends Strongbus.Bus<T> {
  private readonly emulateListenerCount: boolean = false;
  constructor(options: Strongbus.Options & {emulateListenerCount?: boolean}) {
    super(options);
    this.emulateListenerCount = options.emulateListenerCount;
  }

  public emit<E extends EventKeys<T>>(event: E, payload: T[E]): boolean {
    super.emit(event, payload);
    return this.emulateListenerCount;
  }
}


describe('Strongbus.Bus', () => {
  let bus: Strongbus.Bus<TestEventMap>;
  let onTestEvent: jasmine.Spy;
  let onAnyEvent: jasmine.Spy;
  let onEveryEvent: jasmine.Spy;

  beforeEach(() => {
    bus = new Strongbus.Bus<TestEventMap>();
    onTestEvent = jasmine.createSpy('onTestEvent');
    onAnyEvent = jasmine.createSpy('onAnyEvent');
    onEveryEvent = jasmine.createSpy('onEveryEvent');
    spyOn(bus as any, 'handleUnexpectedEvent');
  });

  describe('#constructor', () => {
    it('overloads the instance\'s internal emitter\'s emit method to invoke * listeners on every event raised', () => {
      bus.on('foo', onTestEvent);
      bus.on('*', onEveryEvent);

      bus.emit('foo', 'eagle');
      expect(onTestEvent).toHaveBeenCalledWith('eagle');
      expect(onEveryEvent).toHaveBeenCalledWith('foo', 'eagle');
    });

    describe('given an unhandled event is raised', () => {
      describe('and given the `allowUnhandledEvent` option is false', () => {
        it('invokes instance\'s #handleUnexpectedEvent method', () => {
          bus = new Strongbus.Bus({allowUnhandledEvents: false});
          spyOn(bus as any, 'handleUnexpectedEvent');
          bus.emit('foo', 'oops');

          expect((bus as any).handleUnexpectedEvent).toHaveBeenCalledWith('foo', 'oops');
        });
      });
      describe('and given the `allowUnhandledEvent` option is true (default)', () => {
        it('does not invoke instance\'s #handleUnexpectedEvent method', () => {
          bus.emit('foo', 'oops');

          expect((bus as any).handleUnexpectedEvent).not.toHaveBeenCalled();
        });
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

    describe('returns a Subscription', () => {
      it('which can be disposed by direct invocation', () => {
        const unsub = bus.on('foo', () => { return; });
        expect(bus.hasListeners).toBeTruthy();

        unsub();
        expect(bus.hasListeners).toBeFalsy();
      });

      it('which can be disposed by calling .unsubscribe on the Subscription reference', () => {
        const unsub2 = bus.on('foo', () => { return; });
        expect(bus.hasListeners).toBeTruthy();

        unsub2.unsubscribe();
        expect(bus.hasListeners).toBeFalsy();
      });
    });

    describe('given the wildcard operator to listen on', () => {
      describe('and given an event is raised', () => {
        it('invokes the supplied handler with event and payload', () => {
          bus.on('*', onEveryEvent);
          bus.emit('foo', 'raccoon');
          expect(onEveryEvent).toHaveBeenCalledTimes(1);
          expect(onEveryEvent).toHaveBeenCalledWith('foo', 'raccoon');
          bus.emit('foo', 'squirrel');
          expect(onEveryEvent).toHaveBeenCalledTimes(2);
          expect(onEveryEvent).toHaveBeenCalledWith('foo', 'squirrel');
          bus.emit('baz', 5);
          expect(onEveryEvent).toHaveBeenCalledTimes(3);
          expect(onEveryEvent).toHaveBeenCalledWith('baz', 5);
        });
      });
    });

    describe('given a list of events to listen on', () => {
      beforeEach(() => {
        bus.on(['foo', 'bar'], onAnyEvent);
      });
      describe('given one of the events in the list is raised', () => {
        it('invokes the supplied handler with event and payload', () => {
          bus.emit('foo', 'flamingo');
          expect(onAnyEvent).toHaveBeenCalledTimes(1);
          expect(onAnyEvent.calls.mostRecent().args).toEqual(['foo', 'flamingo']);
          bus.emit('bar', true);
          expect(onAnyEvent).toHaveBeenCalledTimes(2);
          expect(onAnyEvent.calls.mostRecent().args).toEqual(['bar', true]);
        });
      });

      describe('given an event not in the list is raised', () => {
        it('does not invoke the handler', () => {
          bus.emit('baz', 5);
          expect(onAnyEvent).toHaveBeenCalledTimes(0);
        });
      });
    });
  });

  describe('#any', () => {
    it('adds the same listener for each event given, and the listener receives the event as arg[0]', () => {
      bus.any(['foo', 'bar'], onAnyEvent);
      bus.emit('foo', 'sandwich');

      expect(onAnyEvent).toHaveBeenCalledWith('foo', 'sandwich');

      bus.emit('bar', false);
      expect(onAnyEvent).toHaveBeenCalledWith('bar', false);
    });

    it('returns an unsubscribe function that removes the listener', () => {
      bus = new Strongbus.Bus({allowUnhandledEvents: false});
      spyOn(bus as any, 'handleUnexpectedEvent');

      const unsubFoo = bus.any(['foo', 'bar'], onAnyEvent);
      bus.emit('foo', null);
      expect(onAnyEvent).toHaveBeenCalledTimes(1);
      expect((bus as any).handleUnexpectedEvent).not.toHaveBeenCalled();
      onAnyEvent.calls.reset();

      unsubFoo();
      bus.emit('bar', null);
      expect(onAnyEvent).not.toHaveBeenCalled();
      expect((bus as any).handleUnexpectedEvent).toHaveBeenCalledWith('bar', null);
      (bus as any).handleUnexpectedEvent.calls.reset();

      bus.emit('baz', null);
      expect(onAnyEvent).not.toHaveBeenCalled();
      expect((bus as any).handleUnexpectedEvent).toHaveBeenCalledWith('baz', null);
    });
  });

  describe('event delegation', () => {
    let bus2: DelegateTestBus;
    let bus3: DelegateTestBus;

    describe('#pipe', () => {
      beforeEach(() => {
        bus2 = new DelegateTestBus({emulateListenerCount: true});
      });

      describe('given an event is raised from the parent bus', () => {
        it('handles the event on the parent bus AND the delegate bus', () => {
          spyOn(bus2, 'emit');
          bus.pipe(bus2);

          bus.on('foo', onTestEvent);
          bus.emit('foo', 'wow!');

          expect(onTestEvent).toHaveBeenCalledWith('wow!');
          expect(bus2.emit).toHaveBeenCalledWith('foo', 'wow!');
        });
      });

      it('counts piped listeners as handlers when events are raised', () => {
        bus = new Strongbus.Bus({allowUnhandledEvents: false});
        spyOn(bus as any, 'handleUnexpectedEvent');
        bus.emit('foo', null);
        expect((bus as any).handleUnexpectedEvent).toHaveBeenCalled();
        (bus as any).handleUnexpectedEvent.calls.reset();

        bus.pipe(bus2);
        bus.emit('foo', null);
        expect((bus as any).handleUnexpectedEvent).not.toHaveBeenCalled();
        bus.unpipe(bus2);

        // removed the delegate, bus has no listeners again
        bus.emit('foo', null);
        expect((bus as any).handleUnexpectedEvent).toHaveBeenCalled();
        (bus as any).handleUnexpectedEvent.calls.reset();

        // emulate a delegate bus with no listeners attached
        bus3 = new DelegateTestBus({emulateListenerCount: false});
        bus.pipe(bus3);

        bus.emit('foo', null);
        expect((bus as any).handleUnexpectedEvent).toHaveBeenCalled();
      });

      it('bubbles unhandled events to the parent regardless of whether the delegate allows them', () => {
        bus = new Strongbus.Bus({allowUnhandledEvents: false});
        bus2 = new DelegateTestBus({allowUnhandledEvents: true});
        bus3 = new DelegateTestBus({allowUnhandledEvents: false, emulateListenerCount: false});
        spyOn(bus as any, 'handleUnexpectedEvent');
        spyOn(bus2 as any, 'handleUnexpectedEvent');
        spyOn(bus3 as any, 'handleUnexpectedEvent');

        bus.pipe(bus2);
        bus.pipe(bus3);
        bus.emit('foo', null);
        expect((bus3 as any).handleUnexpectedEvent).toHaveBeenCalled();
        expect((bus2 as any).handleUnexpectedEvent).not.toHaveBeenCalled();
        expect((bus as any).handleUnexpectedEvent).toHaveBeenCalled();
      });

      it('can be chained', () => {
        bus2 = new DelegateTestBus({});
        bus3 = new DelegateTestBus({});

        spyOn(bus, 'emit').and.callThrough();
        spyOn(bus2, 'emit').and.callThrough();
        spyOn(bus3, 'emit');

        bus.pipe(bus2).pipe(bus3);

        bus.emit('foo', 'woot');
        expect(bus2.emit).toHaveBeenCalledWith('foo', 'woot');
        expect(bus3.emit).toHaveBeenCalledWith('foo', 'woot');

        bus2.emit('bar', null);
        expect(bus.emit).not.toHaveBeenCalledWith('bar', null);
        expect(bus3.emit).toHaveBeenCalledWith('bar', null);
      });
    });

    describe('#unpipe', () => {

      beforeEach(() => {
        bus2 = new DelegateTestBus({emulateListenerCount: true});
      });

      it('removes a piped msg bus', () => {
        spyOn(bus2, 'emit');
        bus.pipe(bus2);

        bus.emit('foo', 'wow!');

        expect(bus2.emit).toHaveBeenCalledWith('foo', 'wow!');
        (bus2.emit as any).calls.reset();

        bus.unpipe(bus2);

        bus.emit('foo', 'wow!');
        expect(bus2.emit).not.toHaveBeenCalled();
      });

      it('breaks the a chain of piped buses', () => {
        bus3 = new DelegateTestBus({});
        spyOn(bus2, 'emit').and.callThrough();
        spyOn(bus3, 'emit').and.callThrough();

        bus.pipe(bus2).pipe(bus3);
        bus.emit('foo', null);

        expect(bus2.emit).toHaveBeenCalledWith('foo', null);
        expect(bus3.emit).toHaveBeenCalledWith('foo', null);
        (bus2.emit as jasmine.Spy).calls.reset();
        (bus3.emit as jasmine.Spy).calls.reset();

        bus.unpipe(bus2);
        bus.emit('foo', null);
        expect(bus2.emit).not.toHaveBeenCalled();
        expect(bus3.emit).not.toHaveBeenCalled();

        // bus2 is still delegating to bus3 via the chain
        bus2.emit('foo', null);
        expect(bus3.emit).toHaveBeenCalledWith('foo', null);
      });
    });
  });

  describe('#proxy', () => {
    it('adds a proxy handler for raised events that receives the event as well as the payload', () => {
      const proxy = jasmine.createSpy('proxy');
      bus.on('foo', onTestEvent);
      bus.every(onEveryEvent);
      bus.proxy(proxy);

      bus.emit('foo', 'cat');
      expect(onTestEvent).toHaveBeenCalledWith('cat');
      expect(onEveryEvent).toHaveBeenCalled();
      expect(proxy).toHaveBeenCalledWith('foo', 'cat');
      expect(proxy).toHaveBeenCalledTimes(1);
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

    beforeEach(() => {
      bus.hook('willAddListener', onWillAddListener = jasmine.createSpy('onWillAddListener'));
      bus.hook('didAddListener', onAddListener = jasmine.createSpy('onAddListener'));
      bus.hook('willRemoveListener', onWillRemoveListener = jasmine.createSpy('onWillRemoveListener'));
      bus.hook('didRemoveListener', onRemoveListener = jasmine.createSpy('onRemoveListener'));
      bus.hook('willActivate', onWillActivate = jasmine.createSpy('onWillActivate'));
      bus.hook('active', onActive = jasmine.createSpy('onActive'));
      bus.hook('willIdle', onWillIdle = jasmine.createSpy('onWillIdle'));
      bus.hook('idle', onIdle = jasmine.createSpy('onIdle'));
    });

    it('allows subscription to meta events', () => {
      onWillActivate.and.callFake(() => expect(bus.hasListeners).toBeFalse());
      onActive.and.callFake(() => expect(bus.hasListeners).toBeTrue());
      onWillIdle.and.callFake(() => expect(bus.hasListeners).toBeTrue());
      onIdle.and.callFake(() => expect(bus.hasListeners).toBeFalse());

      const foosub = bus.on('foo', onTestEvent);
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
      const foosub = bus.on('foo', onTestEvent);
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
      expect(bus.hasListeners).toBeFalsy();
      bus.on('foo', onTestEvent);
      expect(onWillActivate).toHaveBeenCalled();
      expect(onActive).toHaveBeenCalledTimes(1);
      expect(bus.hasListeners).toBeTruthy();

      bus.on('bar', onTestEvent);
      expect(onWillActivate).toHaveBeenCalledTimes(1);
      expect(onActive).toHaveBeenCalledTimes(1);
    });

    it('only raises "willIdle" and "idle" events when the bus goes from 1 to 0 listeners', () => {
      expect(bus.hasListeners).toBeFalsy();
      const foosub = bus.on('foo', onTestEvent);
      const barsub = bus.on('bar', onTestEvent);
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
      expect(bus.hasListeners).toBeFalsy();
      const foosub1 = bus.on('foo', onTestEvent);
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

    // if subscriptions are the same, then they are grouped
    it('allows duplicate subscriptions', () => {
      expect(bus.hasListeners).toBeFalse();
      const sub1 = bus.on('foo', onTestEvent);
      const sub2 = bus.on('foo', onTestEvent);

      sub1();
      expect(bus.hasListeners).toBeFalse();
      expect(onWillRemoveListener).toHaveBeenCalled();
      expect(onRemoveListener).toHaveBeenCalled();
      expect(onWillIdle).toHaveBeenCalled();
      expect(onIdle).toHaveBeenCalled();

      // second unsubscription is redundant
      sub2();
    });

    describe('given bus has delegates', () => {
      let delegate: DelegateTestBus;
      let onDelegateWillAddListener: jasmine.Spy;
      let onDelegateDidAddListener: jasmine.Spy;
      let onDelegateWillRemoveListener: jasmine.Spy;
      let onDelegateDidRemoveListener: jasmine.Spy;
      let onDelegateWillActivate: jasmine.Spy;
      let onDelegateActive: jasmine.Spy;
      let onDelegateWillIdle: jasmine.Spy;
      let onDelegateIdle: jasmine.Spy;

      beforeEach(() => {
        delegate = new DelegateTestBus({});
        bus.pipe(delegate);

        delegate.hook('willAddListener', onDelegateWillAddListener = jasmine.createSpy('onDelegateWillAddListener'));
        delegate.hook('didAddListener', onDelegateDidAddListener = jasmine.createSpy('onDelegateDidAddListener'));
        delegate.hook('willRemoveListener', onDelegateWillRemoveListener = jasmine.createSpy('onDelegateWillRemoveListener'));
        delegate.hook('didRemoveListener', onDelegateDidRemoveListener = jasmine.createSpy('onDelegateDidRemoveListener'));
        delegate.hook('willActivate', onDelegateWillActivate = jasmine.createSpy('onDelegateWillActivate'));
        delegate.hook('active', onDelegateActive = jasmine.createSpy('onDelegateActive'));
        delegate.hook('willIdle', onDelegateWillIdle = jasmine.createSpy('onDelegateWillIdle'));
        delegate.hook('idle', onDelegateIdle = jasmine.createSpy('onDelegateIdle'));
      });

      it('bubbles events from delegates', () => {
        const sub = delegate.on('foo', onTestEvent);
        expect(onDelegateWillAddListener).toHaveBeenCalledWith('foo');
        expect(onWillAddListener).toHaveBeenCalledWith('foo');

        expect(onDelegateDidAddListener).toHaveBeenCalledWith('foo');
        expect(onAddListener).toHaveBeenCalledWith('foo');

        expect(onDelegateWillActivate).toHaveBeenCalled();
        expect(onWillActivate).toHaveBeenCalled();

        expect(onDelegateActive).toHaveBeenCalled();
        expect(onActive).toHaveBeenCalled();


        sub.unsubscribe();
        expect(onDelegateWillRemoveListener).toHaveBeenCalledWith('foo');
        expect(onRemoveListener).toHaveBeenCalledWith('foo');

        expect(onDelegateDidRemoveListener).toHaveBeenCalledWith('foo');
        expect(onRemoveListener).toHaveBeenCalledWith('foo');

        expect(onDelegateWillIdle).toHaveBeenCalled();
        expect(onWillIdle).toHaveBeenCalled();

        expect(onDelegateIdle).toHaveBeenCalled();
        expect(onIdle).toHaveBeenCalled();
      });


      it('raises "active" events independently of delegates', () => {
        expect(onActive).toHaveBeenCalledTimes(0);
        expect(onDelegateActive).toHaveBeenCalledTimes(0);
        bus.on('foo', onTestEvent);
        expect(onActive).toHaveBeenCalledTimes(1);
        expect(onDelegateActive).toHaveBeenCalledTimes(0);
        delegate.on('foo', onTestEvent);
        expect(onDelegateActive).toHaveBeenCalledTimes(1);
        expect(onActive).toHaveBeenCalledTimes(1);
      });

      it('raises "idle" events independently of delegates', () => {
        const foosub = bus.on('foo', onTestEvent);
        const fooSub2 = delegate.on('foo', onTestEvent);

        fooSub2.unsubscribe();
        expect(onDelegateIdle).toHaveBeenCalledTimes(1);
        onDelegateIdle.calls.reset();
        expect(onIdle).toHaveBeenCalledTimes(0);

        foosub.unsubscribe();
        expect(onDelegateIdle).toHaveBeenCalledTimes(0);
        expect(onIdle).toHaveBeenCalledTimes(1);
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
        bus.on('foo', onTestEvent);
        expect(handleActiveChange).toHaveBeenCalledWith(true);
      });
    });

    describe('given the bus goes from 1 to 0 listeners', () => {
      it('invokes a callback with `false`', () => {
        const foosub = bus.on('foo', onTestEvent);
        expect(handleActiveChange).toHaveBeenCalledWith(true);
        foosub();
        expect(handleActiveChange).toHaveBeenCalledWith(false);
      });
    });
  });

  describe('#hasListeners', () => {
    describe('given there are any event listeners on the instance', () => {
      it('returns true', () => {
        bus.every(onEveryEvent);
        expect(bus.hasListeners).toBeTruthy();
      });
    });

    describe('given there are no listeners registered with the instance', () => {
      it('returns false', () => {
        expect(bus.hasListeners).toBeFalsy();
      });
    });
  });

  describe('#listeners', () => {
    let bus2: DelegateTestBus;

    beforeEach(() => {
      bus2 = new DelegateTestBus({emulateListenerCount: true});
    });

    describe('given there are event listeners on the instance', () => {
      beforeEach(() => {
        bus.on('foo', onTestEvent);
      });

      describe('and there are no delegate listeners', () => {
        it('lists the listeners on the instance', () => {
          expect(bus.listeners).toEqual(new Map([[
            'foo', new Set([onTestEvent])
          ]]));
          bus.on('*', onAnyEvent);
          expect(bus.listeners.get('foo')).toEqual(new Set([onTestEvent]));
          expect(bus.listeners.get('*').size).toEqual(1); // will be an anonymous wrapper around onEveryEvent
        });
      });

      describe('and the instance has delegates with no listeners', () => {
        it("lists the instance's listeners", () => {
          bus.pipe(bus2);
          expect(bus.listeners).toEqual(new Map([[
            'foo', new Set([onTestEvent])
          ]]));
        });
      });

      describe('and the instance has delegates with listeners', () => {
        it("lists the instance's listeners and the delegate listeners", () => {
          bus.pipe(bus2);
          bus2.on('foo', onAnyEvent);
          expect(bus.listeners).toEqual(new Map([[
            'foo', new Set([onTestEvent, onAnyEvent])
          ]]));
        });
      });
    });

    describe('given there are no event listeners on the instance', () => {
      describe('and the instance has delegates with listeners', () => {
        it('lists the delegate listeners', () => {
          bus.pipe(bus2);
          bus2.on('foo', onAnyEvent);
          expect(bus.listeners).toEqual(new Map([[
            'foo', new Set([onAnyEvent])
          ]]));
        });
      });

      describe('and the instance has delegates with no listeners', () => {
        it('returns an empty object', () => {
          bus.pipe(bus2);
          expect(bus.listeners.size).toEqual(0);
        });
      });

      describe('and the instance has no delegates', () => {
        it('returns an empty object', () => {
          expect(bus.listeners.size).toEqual(0);
        });
      });
    });
  });

  describe('#hasListenersFor', () => {
    describe('given an instance has no listeners registered for an event', () => {
      it('returns false', () => {
        bus.destroy();
        expect(bus.hasListenersFor('foo')).toBe(false);
      });

      describe('given an instance has delegates registered for an event', () => {
        it('returns true', () => {
          bus.destroy();
          const bus2 = new DelegateTestBus({emulateListenerCount: true});
          bus.pipe(bus2);
          bus2.on('foo', () => {return; });
          expect(bus.hasListenersFor('foo')).toBe(true);
        });
      });
    });

    describe('given an instance has listeners registered for an event', () => {
      it('returns true', () => {
        bus.destroy();
        const handleFoo = (payload: string) => {return; };
        bus.on('foo', handleFoo);

        expect(bus.hasListenersFor('foo')).toBe(true);
      });
    });
  });

  describe('#destroy', () => {
    it('removes all event listeners, triggering proper lifecycle events', () => {
      bus = new Strongbus.Bus({allowUnhandledEvents: false});
      spyOn(bus as any, 'handleUnexpectedEvent');
      const willRemoveListenerSpy = jasmine.createSpy('willRemoveListener');
      const didRemoveListenerSpy = jasmine.createSpy('didRemoveListener');
      bus.on('foo', onTestEvent);
      bus.hook('willRemoveListener', willRemoveListenerSpy);
      bus.hook('didRemoveListener', didRemoveListenerSpy);
      bus.every(onEveryEvent);

      bus.emit('foo', null);
      expect(onTestEvent).toHaveBeenCalled();
      expect(onEveryEvent).toHaveBeenCalled();
      onTestEvent.calls.reset();
      onEveryEvent.calls.reset();

      bus.destroy();

      expect(willRemoveListenerSpy).toHaveBeenCalledWith('foo');
      expect(didRemoveListenerSpy).toHaveBeenCalledWith('foo');
      expect(bus.hasListenersFor('foo')).toBe(false);
      bus.emit('foo', null);
      expect(onTestEvent).not.toHaveBeenCalled();
      expect(onEveryEvent).not.toHaveBeenCalled();
      expect((bus as any).handleUnexpectedEvent).toHaveBeenCalled();
    });

    it('removes all hooks', () => {
      const didAddListenerSpy = jasmine.createSpy('onAddListener');
      bus.hook('didAddListener', didAddListenerSpy);
      bus.on('foo', onTestEvent);
      expect(didAddListenerSpy).toHaveBeenCalledWith('foo');
      didAddListenerSpy.calls.reset();

      bus.destroy();
      bus.on('foo', onTestEvent);
      expect(didAddListenerSpy).not.toHaveBeenCalled();
    });

    it('clears all delegates', () => {
      const bus2 = new DelegateTestBus({});
      bus2.on('foo', onTestEvent);
      bus2.every(onEveryEvent);

      bus.pipe(bus2);

      bus.emit('foo', null);
      expect(onTestEvent).toHaveBeenCalled();
      expect(onEveryEvent).toHaveBeenCalled();
      onTestEvent.calls.reset();
      onEveryEvent.calls.reset();

      bus.destroy();
      bus.emit('foo', null);
      expect(onTestEvent).not.toHaveBeenCalled();
      expect(onEveryEvent).not.toHaveBeenCalled();
    });
  });

  describe('Reserved events', () => {
    describe('given the wildcard (*) event is manually raised', () => {
      it('raises an error', () => {
        bus.on('*', onAnyEvent);
        const shouldThrow = () => bus.emit('*' as any, 'eagle');

        expect(shouldThrow).toThrow();
      });
    });
  });

  describe('unsubscribe function return values (Events.Subscription)s', () => {
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

        const unsub = bus.on('foo', onTestEvent);

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
          expect(onResolve).toHaveBeenCalledWith('FOO!');
          onResolve.calls.reset();
          bus.emit('foo', 'BAR!');
          expect(onResolve).not.toHaveBeenCalled();
          expect(onReject).not.toHaveBeenCalled();
        });

        it('unsubscribes from the event source', () => {
          expect([...bus.listeners.keys()]).toEqual(['foo', 'bar']);
          bus.emit('foo', 'FOO!');
          expect([...bus.listeners.keys()]).toEqual([]);
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
          expect([...bus.listeners.keys()]).toEqual(['foo', 'bar']);
          bus.emit('bar', true);
          expect([...bus.listeners.keys()]).toEqual([]);
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
          expect(onResolve).toHaveBeenCalledWith('FOO!');
          onResolve.calls.reset();
          bus.emit('foo', 'BAR!');
          expect(onResolve).not.toHaveBeenCalled();
          expect(onReject).not.toHaveBeenCalled();
        });

        it('unsubscribes from the event source', () => {
          expect([...bus.listeners.keys()]).toEqual(['foo']);
          bus.emit('foo', 'FOO!');
          expect([...bus.listeners.keys()]).toEqual([]);
        });
      });
    });

    describe('given the promise is canceled', () => {
      it('unsubscribes from the event source', async () => {
        const p = bus.next('foo');
        p.then(onResolve).catch(onReject);
        expect([...bus.listeners.keys()]).toEqual(['foo']);
        p.cancel();
        await sleep(1);
        expect(onReject).toHaveBeenCalled();
        expect([...bus.listeners.keys()]).toEqual([]);
      });
    });

    describe('given the resolving event is the wildcard "*"', () => {
      it('resolves on any event with an undefined value', async () => {
        const p1 = bus.next('*');
        p1.then(onResolve);
        bus.emit('baz', 3);
        await sleep(1);
        expect(onResolve).toHaveBeenCalledWith(undefined);
        onResolve.calls.reset();
        const p2 = bus.next('*');
        p2.then(onResolve);
        bus.emit('foo', 'FOO!');
        await sleep(1);
        expect(onResolve).toHaveBeenCalledWith(undefined);
      });
    });

    describe('given an array of resolving events', () => {
      it('resolves on any of the events in the array with an undefined value', async () => {
        const p1 = bus.next(['bar', 'baz']);
        p1.then(onResolve);
        bus.emit('baz', 5);
        await sleep(1);
        expect(onResolve).toHaveBeenCalledWith(undefined);
        onResolve.calls.reset();
        const p2 = bus.next(['foo', 'baz']);
        p2.then(onResolve);
        bus.emit('foo', 'FOO!');
        await sleep(1);
        expect(onResolve).toHaveBeenCalledWith(undefined);
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
        expect([...bus.listeners.keys()]).toEqual([]);
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
      it('resolves the promise', async () => {
        let hasFoo: boolean = false;
        const evaluator = (resolve: Scanner.Resolver<boolean>, reject: Scanner.Rejecter) => {
          if(hasFoo) {
            resolve(true);
          }
        };
        const p = bus.scan<boolean>({
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

        expect([...bus.listeners.keys()]).toEqual([]);
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
        const p = bus.scan<boolean>({
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

        expect([...bus.listeners.keys()]).toEqual([]);
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
          const p = bus.scan<boolean>({
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
          const p = bus.scan<boolean>({
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
          const p = bus.scan<boolean>({
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
        const p = bus.scan<boolean>({
          evaluator,
          trigger: 'foo'
        });

        p.then(onResolve);
        await sleep(1);

        expect(onResolve).toHaveBeenCalledWith(true);

      });

      describe('and options.eager=false', () => {
        it('does not resolve the promise until it receives an event triggering evaluation', async () => {
          const hasFoo: boolean = true;
          const evaluator = (resolve: Scanner.Resolver<boolean>, reject: Scanner.Rejecter) => {
            if(hasFoo) {
              resolve(true);
            }
          };
          const p = bus.scan<boolean>({
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
    });
  });
});