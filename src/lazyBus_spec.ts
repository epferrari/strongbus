import * as Strongbus from './';

type TestEventMap = {
  foo: string;
  bar: boolean;
};

const MANAGERS = ['logger', 'lifecycle', 'subscriptions', 'introspection', 'scanners', 'dispatcher'];

/** The managers a bus has built so far; they live in the private `_<name>` fields. */
function built(bus: object): string[] {
  return MANAGERS.filter(name => (bus as any)[`_${name}`] !== undefined);
}

describe('a bus that nothing has subscribed to', () => {
  let bus: Strongbus.Bus<TestEventMap>;

  beforeEach(() => {
    bus = new Strongbus.Bus<TestEventMap>();
  });

  it('builds no managers when constructed', () => {
    expect(built(bus)).toEqual([]);
  });

  it('builds no managers when it emits', () => {
    expect(bus.emit('foo', 'a')).toBe(false);
    expect(built(bus)).toEqual([]);
  });

  it('builds no managers when it is cleared or destroyed', () => {
    bus.clear();
    bus.destroy();
    expect(built(bus)).toEqual([]);
  });

  it('is not active', () => {
    expect(bus.active).toBe(false);
    expect(built(bus)).toEqual([]);
  });

  describe('when asked about its listeners', () => {
    const scopes = [
      Strongbus.ListenerScope.ANY,
      Strongbus.ListenerScope.OWN,
      Strongbus.ListenerScope.DOWNSTREAM
    ];

    it('reports none, in every scope, without building any manager', () => {
      for(const scope of scopes) {
        for(const includeIncognito of [true, false]) {
          const options = {scope, includeIncognito};
          expect(bus.hasListeners(options)).toBe(false);
          expect(bus.getListenerCount(options)).toBe(0);
          expect(bus.getEventCount(options)).toBe(0);
          expect(bus.getListeners(options).size).toBe(0);
          expect(bus.hasListenersFor('foo', options)).toBe(false);
          expect(bus.getListenerCountFor('foo', options)).toBe(0);
          expect(bus.getListenersFor('foo', options).size).toBe(0);
        }
      }
      expect(bus.hasListeners()).toBe(false);
      expect(built(bus)).toEqual([]);
    });

    it('never calls the callback of forEach', () => {
      const fn = jasmine.createSpy('fn');
      bus.forEach(fn);
      expect(fn).not.toHaveBeenCalled();
      expect(built(bus)).toEqual([]);
    });

    it('hands out a new set from getListeners each time, so a caller cannot change later answers', () => {
      const first = bus.getListeners() as Set<() => void>;
      first.add((): void => undefined);
      expect(bus.getListeners().size).toBe(0);
    });

    it('answers correctly once a handler is added and removed again', () => {
      const unsubscribe = bus.on('foo', () => undefined);
      expect(bus.getListenerCount()).toBe(1);
      expect(bus.hasListenersFor('foo')).toBe(true);
      unsubscribe();
      expect(bus.getListenerCount()).toBe(0);
      expect(bus.hasListeners()).toBe(false);
    });

    it('counts the listeners of a downstream', () => {
      const downstream = new Strongbus.Bus<TestEventMap>();
      downstream.on('foo', () => undefined);
      bus.pipe(downstream);
      expect(bus.hasListeners()).toBe(true);
      expect(bus.getListenerCount({scope: Strongbus.ListenerScope.DOWNSTREAM})).toBe(1);
      expect(bus.getListenerCount({scope: Strongbus.ListenerScope.OWN})).toBe(0);
      expect(bus.hasListenersFor('foo')).toBe(true);
      bus.unpipe(downstream);
      expect(bus.hasListeners()).toBe(false);
    });
  });

  it('builds only the subscription collections it uses', () => {
    const handler = (): void => undefined;
    const sub = bus.on('foo', handler);
    sub();
    bus.on('bar', handler);
    bus.clear();
    bus.destroy();
    const subscriptions = (bus as any)._subscriptions;
    const collections = [
      'onceIntents', 'anyIntents', 'tapIntents', 'incognitoByHandler',
      'stackedListenerSurplusByEvent', 'incognitoCountByEvent', 'setsBeingIterated'
    ];
    expect(collections.filter(name => subscriptions[`_${name}`] !== undefined)).toEqual([]);
  });

  describe('given `options.onUnhandledEvent` is `\'throw\'` and the bus only has hooks', () => {
    it('still throws on an unhandled emit', () => {
      bus = new Strongbus.Bus<TestEventMap>({onUnhandledEvent: 'throw'});
      bus.hook('error', () => undefined);
      expect(() => bus.emit('foo', 'x')).toThrowError(/unexpected message type 'foo'/);
    });
  });

  describe('given `options.onUnhandledEvent` is `\'throw\'`', () => {
    beforeEach(() => {
      bus = new Strongbus.Bus<TestEventMap>({onUnhandledEvent: 'throw'});
    });

    it('throws on emit with the event and payload in the message', () => {
      expect(() => bus.emit('foo', 'payload-text')).toThrowError(/'foo'[\s\S]*payload-text/);
    });
  });

  describe('given `options.onUnhandledEvent` is a function', () => {
    it('calls it with the event and payload', () => {
      const onUnhandledEvent = jasmine.createSpy('onUnhandledEvent');
      bus = new Strongbus.Bus<TestEventMap>({onUnhandledEvent});
      bus.emit('bar', true);
      expect(onUnhandledEvent).toHaveBeenCalledOnceWith('bar', true);
    });
  });

  it('refuses the reserved wildcard event, as a bus with handlers does', () => {
    expect(() => bus.emit('*' as any, 'x' as any)).toThrowError(/Reserved for internal use/);
  });

  it('delivers to a handler added after it has emitted', () => {
    bus.emit('foo', 'early');
    const handler = jasmine.createSpy('handler');
    bus.on('foo', handler);
    bus.emit('foo', 'late');
    expect(handler.calls.allArgs()).toEqual([['late']]);
  });

  it('delivers to a downstream even though it has no handlers of its own', () => {
    const downstream = new Strongbus.Bus<TestEventMap>();
    const handler = jasmine.createSpy('handler');
    downstream.on('foo', handler);
    bus.pipe(downstream);
    expect(bus.emit('foo', 'piped')).toBe(true);
    expect(handler).toHaveBeenCalledOnceWith('piped');
  });

  it('stops using the shortcut once its downstream is removed, and reports unhandled events', () => {
    const onUnhandledEvent = jasmine.createSpy('onUnhandledEvent');
    bus = new Strongbus.Bus<TestEventMap>({onUnhandledEvent});
    const downstream = new Strongbus.Bus<TestEventMap>();
    downstream.on('foo', () => undefined);
    bus.pipe(downstream);
    bus.unpipe(downstream);
    expect(bus.emit('foo', 'x')).toBe(false);
    expect(onUnhandledEvent).toHaveBeenCalledOnceWith('foo', 'x');
  });

  it('counts the listeners a downstream gains after it is piped', () => {
    const upstream = new Strongbus.Bus<TestEventMap>();
    upstream.pipe(bus);
    expect(upstream.hasListeners()).toBe(false);
    bus.on('foo', () => undefined);
    expect(upstream.getListenerCount()).toBe(1);
    expect(upstream.active).toBe(true);
  });

  it('keeps each instance separate', () => {
    const other = new Strongbus.Bus<TestEventMap>();
    bus.on('foo', () => undefined);
    expect(built(bus)).toContain('subscriptions');
    expect(built(other)).toEqual([]);
    expect(other.hasListeners()).toBe(false);
  });

  describe('then destroyed under `options.onUseAfterDestroy`', () => {
    it('still guards later calls', () => {
      bus = new Strongbus.Bus<TestEventMap>({onUseAfterDestroy: 'throw'});
      bus.destroy('done');
      expect(bus.destroyed).toBe(true);
      expect(() => bus.on('foo', () => undefined)).toThrowError(/done/);
      expect(bus.emit('foo', 'x')).toBe(false);
    });
  });
});

describe('a bus method used without its bus', () => {
  let bus: Strongbus.Bus<TestEventMap>;

  beforeEach(() => {
    bus = new Strongbus.Bus<TestEventMap>();
  });

  it('works when taken off the bus', () => {
    const {on, emit, off, once, hasListeners, getListenerCount, clear, destroy} = bus;
    const handler = jasmine.createSpy('handler');
    on('foo', handler);
    once('bar', handler);
    emit('foo', 'a');
    emit('bar', true);
    expect(handler.calls.allArgs()).toEqual([['a'], [true]]);
    expect(hasListeners()).toBe(true);
    expect(getListenerCount()).toBe(1);
    off('foo', handler);
    clear();
    destroy();
    expect(bus.destroyed).toBe(true);
  });

  it('works for unpipe and the per-event queries when taken off the bus', () => {
    const upstream = new Strongbus.Bus<TestEventMap>();
    const downstream = new Strongbus.Bus<TestEventMap>();
    const handler = (): void => undefined;
    downstream.on('foo', handler);
    upstream.pipe(downstream);

    const {unpipe, hasListenersFor, getListenerCountFor, getListenersFor} = upstream;
    expect(hasListenersFor('foo')).toBe(true);
    expect(getListenerCountFor('foo')).toBe(1);
    expect(getListenersFor('foo').has(handler)).toBe(true);
    unpipe(downstream);
    expect(hasListenersFor('foo')).toBe(false);
  });

  it('works when passed as a callback', () => {
    const handler = jasmine.createSpy('handler');
    bus.on('foo', handler);
    const emit = bus.emit;
    ['a', 'c'].forEach(payload => emit('foo', payload));
    expect(handler.calls.allArgs()).toEqual([['a'], ['c']]);
  });

  it('is the same function on every read', () => {
    expect(bus.emit).toBe(bus.emit);
    expect(bus.once).toBe(bus.once);
  });

  it('can be replaced on an instance, as a spy would', () => {
    spyOn(bus, 'emit');
    spyOn(bus, 'clear');
    bus.emit('foo', 'x');
    bus.clear();
    expect(bus.emit).toHaveBeenCalledOnceWith('foo', 'x');
    expect(bus.clear).toHaveBeenCalledTimes(1);
  });
});
