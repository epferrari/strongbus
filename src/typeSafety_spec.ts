import {Bus} from './strongbus';
import {Scanner} from './scanner';
import {WILDCARD, type EventMap, type Subscription} from './types/events';
import {Lifecycle, type LifecycleSubjectEvent} from './types/lifecycle';
import {ListenerScope} from './types/listenerScope';
import type {EventHandler, TapHandler, PipedMessage} from './types/eventHandlers';
import type {ListenerSet} from './types/listenerRegistry';
import type {ControlSurface} from './types/surfaces/controlSurface';
import type {IntrospectionSurface} from './types/surfaces/introspectionSurface';
import type {MonitoringSurface} from './types/surfaces/monitoringSurface';
import type {SubscriptionSurface} from './types/surfaces/subscriptionSurface';
import type {EventKeys, SubscribableEventKeys, VoidEventKeys} from './types/utility';
import type {Merge} from './types/merge';

/**
 * These specs are primarily *compile-time* assertions. The test pipeline runs
 * `tsc` before jasmine, so every `// @ts-expect-error` below doubles as an
 * assertion: if the following line were to compile, tsc would report the
 * directive as unused (TS2578) and fail the build.
 */
describe('type safety', () => {
  interface TestEventMap {
    foo: number;
    bar: string;
    baz: void;
  }

  interface WildcardEventMap extends TestEventMap {
    '*': unknown;
  }

  // asserts at compile time that `value` is assignable to `T`
  function expectType<T>(_value: T): void {
    // type-level assertion only; no runtime behavior
  }


  describe('#on', () => {
    it('accepts valid event and payload types', () => {
      const bus = new Bus<TestEventMap>();
      bus.on('foo', payload => expectType<number>(payload));
      bus.on('baz', payload => expectType<void>(payload));
    });

    it('accepts SubscribeOptions', () => {
      const bus = new Bus<TestEventMap>();
      bus.on('foo', () => undefined, {incognito: true});
      bus.once('bar', () => undefined, {incognito: true});
      bus.any(['foo', 'bar'], () => undefined, {incognito: true});
    });

    it('rejects unknown event', () => {
      const bus = new Bus<TestEventMap>();
      // @ts-expect-error 'qux' is not a key of TestEventMap
      bus.on('qux', () => undefined);
    });

    it('rejects mismatched payload', () => {
      const bus = new Bus<TestEventMap>();
      // @ts-expect-error 'foo' carries a number payload, not a string
      bus.on('foo', (payload: string) => undefined);
    });

    it('rejects wildcard', () => {
      const bus = new Bus<WildcardEventMap>();
      // @ts-expect-error WILDCARD is reserved for internal use
      bus.on(WILDCARD, () => undefined);
      // @ts-expect-error WILDCARD is reserved for internal use
      bus.on('*', () => undefined);
    });
  });

  describe('#off', () => {
    it('accepts valid event and handler types', () => {
      const bus = new Bus<TestEventMap>();
      const handleFoo = (payload: number) => {
        expectType<number>(payload);
      };
      bus.on('foo', handleFoo);
      bus.off('foo', handleFoo);
      expectType<void>(bus.off('foo', handleFoo));
    });

    it('rejects unknown event', () => {
      const bus = new Bus<TestEventMap>();
      // @ts-expect-error 'qux' is not a key of TestEventMap
      bus.off('qux', () => undefined);
    });

    it('rejects mismatched handler payload', () => {
      const bus = new Bus<TestEventMap>();
      // @ts-expect-error 'foo' carries a number payload, not a string
      bus.off('foo', (payload: string) => undefined);
    });

    it('rejects wildcard', () => {
      const bus = new Bus<WildcardEventMap>();
      // @ts-expect-error WILDCARD is reserved for internal use
      bus.off(WILDCARD, () => undefined);
      // @ts-expect-error WILDCARD is reserved for internal use
      bus.off('*', () => undefined);
    });
  });

  describe('#once', () => {
    it('accepts valid event and payload types', () => {
      const bus = new Bus<TestEventMap>();
      bus.once('bar', payload => expectType<string>(payload));
    });

    it('rejects unknown event', () => {
      const bus = new Bus<TestEventMap>();
      // @ts-expect-error 'qux' is not a key of TestEventMap
      bus.once('qux', () => undefined);
    });

    it('rejects mismatched payload', () => {
      const bus = new Bus<TestEventMap>();
      // @ts-expect-error 'bar' carries a string payload, not a number
      bus.once('bar', (payload: number) => undefined);
    });

    it('rejects wildcard', () => {
      const bus = new Bus<WildcardEventMap>();
      // @ts-expect-error WILDCARD is reserved for internal use
      bus.once(WILDCARD, () => undefined);
      // @ts-expect-error WILDCARD is reserved for internal use
      bus.once('*', () => undefined);
    });
  });

  describe('#any', () => {
    it('accepts a valid event subset', () => {
      const bus = new Bus<TestEventMap>();
      bus.any(['foo', 'bar'], (event, payload) => {
        expectType<keyof TestEventMap>(event);
        expectType<TestEventMap[keyof TestEventMap]>(payload);
      });
    });

    it('rejects unknown event', () => {
      const bus = new Bus<TestEventMap>();
      // @ts-expect-error 'qux' is not a key of TestEventMap
      bus.any(['foo', 'qux'], () => undefined);
    });

    it('rejects wildcard', () => {
      const bus = new Bus<WildcardEventMap>();
      // @ts-expect-error WILDCARD is reserved for internal use
      bus.any([WILDCARD], () => undefined);
      // @ts-expect-error WILDCARD is reserved for internal use
      bus.any(['*'], () => undefined);
      // @ts-expect-error WILDCARD is reserved for internal use
      bus.any(['foo', '*'], () => undefined);
    });
  });

  describe('#next', () => {
    it('accepts valid resolution and rejection triggers', () => {
      const bus = new Bus<TestEventMap>();
      // single event resolves with the triggering event and its payload
      bus.next('foo').then(result => {
        expectType<'foo'>(result.event);
        expectType<number>(result.payload);
      });
      // disjoint resolution/rejection triggers are allowed
      bus.next('foo', 'bar');
      bus.next('foo', {incognito: true});
      bus.next('foo', 'bar', {incognito: true});
      // a multi-event trigger resolves with a discriminated {event, payload} union
      bus.next(['foo', 'bar']).then(result => {
        expectType<'foo' | 'bar'>(result.event);
        if(result.event === 'foo') {
          expectType<number>(result.payload);
        } else {
          expectType<string>(result.payload);
        }
      });
    });

    it('rejects wildcard resolution trigger', () => {
      const bus = new Bus<TestEventMap>();
      // @ts-expect-error wildcard is not allowed as a resolution trigger
      bus.next('*');
    });

    it('rejects wildcard rejection trigger', () => {
      const bus = new Bus<TestEventMap>();
      // @ts-expect-error wildcard is not allowed as a rejection trigger
      bus.next('foo', '*');
    });

    it('rejects unknown resolution trigger', () => {
      const bus = new Bus<TestEventMap>();
      // @ts-expect-error 'qux' is not a key of TestEventMap
      bus.next('qux');
    });

    it('rejects unknown rejection trigger', () => {
      const bus = new Bus<TestEventMap>();
      // @ts-expect-error 'qux' is not a key of TestEventMap
      bus.next('foo', 'qux');
    });

    it('rejects overlapping triggers', () => {
      const bus = new Bus<TestEventMap>();
      // @ts-expect-error resolution and rejection triggers must be disjoint
      bus.next('foo', 'foo');
      // @ts-expect-error wildcard is not allowed as a resolution trigger
      bus.next('*', 'foo');
      // @ts-expect-error resolution and rejection triggers must be disjoint
      bus.next(['foo', 'bar'], 'foo');
      // @ts-expect-error resolution and rejection triggers must be disjoint
      bus.next(['foo', 'bar'], ['foo']);
    });
  });

  describe('#scan', () => {
    const evaluator: Scanner.Evaluator<boolean, TestEventMap> = resolve => {
      resolve(true);
    };

    it('accepts valid scan triggers', () => {
      const bus = new Bus<TestEventMap>();
      bus.scan('foo', evaluator);
      bus.scan(['foo', 'bar'], evaluator);
      bus.scan('*', evaluator);
      bus.scan({evaluator, trigger: 'foo'});
      bus.scan({evaluator, trigger: ['foo', 'bar']});
      bus.scan({evaluator, trigger: '*'});
    });

    it('rejects unknown trigger', () => {
      const bus = new Bus<TestEventMap>();
      // @ts-expect-error 'qux' is not a key of TestEventMap
      bus.scan('qux', evaluator);
      // @ts-expect-error 'qux' is not a key of TestEventMap
      bus.scan('qux', evaluator);
    });

    it('result type drives evaluator and promise', () => {
      const bus = new Bus<TestEventMap>();
      const result = bus.scan<number>('foo', resolve => {
        resolve(1);
        resolve.resolve(2);
      });
      result.then(value => expectType<number>(value));
      bus.scan<number>('foo', resolve => {
        resolve(1);
        resolve.resolve(2);
      }).then(value => expectType<number>(value));
    });

    it('inferred result type from typed evaluator', () => {
      const bus = new Bus<TestEventMap>();
      bus.scan('foo', evaluator).then(value => expectType<boolean>(value));
      bus.scan({evaluator, trigger: 'foo'}).then(value => expectType<boolean>(value));
    });

    it('rejects mismatched resolve value', () => {
      const bus = new Bus<TestEventMap>();
      bus.scan<number>('foo', resolve => {
        // @ts-expect-error result type is number, not string
        resolve('nope');
      });
      bus.scan<number>({
        evaluator: resolve => {
          // @ts-expect-error result type is number, not string
          resolve('nope');
        },
        trigger: 'foo'
      });
    });

    it('scan evaluator discriminates trigger', () => {
      const bus = new Bus<TestEventMap>();
      const scanEvaluator: Scanner.Evaluator<void, TestEventMap> = resolve => {
        if (resolve.trigger.type === 'event' && resolve.trigger.event === 'foo') {
          expectType<number>(resolve.trigger.payload);
        } else if (resolve.trigger.type === 'event' && resolve.trigger.event === 'bar') {
          expectType<string>(resolve.trigger.payload);
        }
      };
      bus.scan(['foo', 'bar'], scanEvaluator);
      bus.scan({evaluator: scanEvaluator, trigger: ['foo', 'bar']});
    });

    it('scan evaluator rejects uniform trigger payload', () => {
      const bus = new Bus<TestEventMap>();
      const scanEvaluator: Scanner.Evaluator<void, TestEventMap> = resolve => {
        if (resolve.trigger.type === 'event') {
          // @ts-expect-error payload is not uniform across event keys
          const payload: string = resolve.trigger.payload;
        }
      };
      bus.scan(['foo', 'bar'], scanEvaluator);
      bus.scan({evaluator: scanEvaluator, trigger: ['foo', 'bar']});
    });
  });

  describe('#emit', () => {
    it('accepts a correlated payload for a non-void event', () => {
      const bus = new Bus<TestEventMap>();
      bus.emit('foo', 1);
      bus.emit('bar', 'hello');
    });

    it('rejects a mismatched payload', () => {
      const bus = new Bus<TestEventMap>();
      // @ts-expect-error 'foo' carries a number payload, not a string
      bus.emit('foo', 'hello');
    });

    it('requires a payload for a non-void event', () => {
      const bus = new Bus<TestEventMap>();
      // @ts-expect-error 'foo' requires its number payload
      bus.emit('foo');
    });

    it('allows a void event to be emitted without a payload', () => {
      const bus = new Bus<TestEventMap>();
      bus.emit('baz');
      bus.emit('baz', null);
      bus.emit('baz', undefined);
    });

    it('rejects a non-null payload for a void event', () => {
      const bus = new Bus<TestEventMap>();
      // @ts-expect-error 'baz' is a void event and cannot carry a payload
      bus.emit('baz', 1);
    });

    it('rejects an unknown event', () => {
      const bus = new Bus<TestEventMap>();
      // @ts-expect-error 'qux' is not a key of TestEventMap
      bus.emit('qux', 1);
    });

    // `emit(event, payload)` accepts a generic `[K, M[K]]` pair, including when
    // `M` is concrete. Pipe sinks no longer expose separate `(event, payload)`
    // arguments, so the old destructured-forward hole is closed at the pipe layer.
    it('forwards by generic key over a concrete map', () => {
      interface Concrete {
        foo: number;
        bar: string;
      }
      class RelayService {
        private readonly bus = new Bus<Concrete>();
        public sendLocal<T extends keyof Concrete>(event: T, payload: Concrete[T]): void {
          this.bus.emit(event, payload);
        }
      }
      expectType<typeof RelayService>(RelayService);
    });

    it('forwards a single generic key by (event, payload) over an open map', () => {
      class Relay<M extends EventMap> {
        private readonly bus = new Bus<M>();
        public forward<K extends EventKeys<M>>(event: K, payload: M[K]): boolean {
          return this.bus.emit(event, payload);
        }
      }
      expectType<typeof Relay>(Relay);
    });

    // regression: emitting a correlated payload must type-check even when the
    // event map is a generic type parameter (the motivation for dropping the
    // rest-spread payload). See the `emit` entry in CHANGELOG 3.0.0.
    it('correlates the payload when the event map is generic', () => {
      interface Events<T> {
        foo: {a: T[]; b: T[]};
        bar: void;
      }

      class ClassWithGenericEvents<
        OutputType extends object,
        TEvents extends Events<OutputType> = Events<OutputType>
      > {
        protected readonly bus = new Bus<TEvents>();

        public method(a: OutputType[], b: OutputType[]): void {
          this.bus.emit('foo', {a, b});
          this.bus.emit('bar', null);
        }
      }

      expectType<typeof ClassWithGenericEvents>(ClassWithGenericEvents);
    });
  });

  describe('#tap', () => {
    interface Narrow {
      foo: number;
      bar: string;
      baz: void;
    }
    interface Other {
      other: boolean;
    }

    it('narrows payload by discriminating on message.event', () => {
      const bus = new Bus<Narrow>();
      bus.tap((msg: PipedMessage<Narrow>) => {
        if (msg.event === 'foo') {
          expectType<number>(msg.payload);
        } else if (msg.event === 'bar') {
          expectType<string>(msg.payload);
        }
      });
    });

    it('allows split emit from a tap message via a concrete bus reference', () => {
      const src = new Bus<Narrow & {goose: number}>();
      const dst = new Bus<Narrow>();
      src.tap((msg: PipedMessage<Narrow & {goose: number}>) => {
        // @ts-expect-error uncorrelated union event/payload pair
        dst.emit(msg.event, msg.payload);
        // ok if we descriminate first
        if(msg.event === 'foo') {
          dst.emit(msg.event, msg.payload);
        }
      });
    });

    it('pipe(predicate).pipe(dest) accepts a predicate over PipedMessage', () => {
      const src = new Bus<Narrow>();
      const dst = new Bus<Narrow>();
      src.pipe((msg: PipedMessage<Narrow>) => msg.event === 'foo').pipe(dst);
    });

  });

  describe('#pipe (bus downstream)', () => {
    interface Narrow {
      foo: number;
      bar: string;
      baz: void;
    }
    interface Other {
      other: boolean;
    }

    it('pipes into a wider, partially-overlapping, or disjoint downstream bus', () => {
      const src = new Bus<Narrow>();
      const noOverlap = new Bus<Other>();
      const partialOverlap = new Bus<Pick<Narrow, 'foo'> & Pick<Other, 'other'>>();
      const properSubset = new Bus<Pick<Narrow, 'foo'>>();

      src.pipe(partialOverlap);
      src.pipe(properSubset);
      src.pipe(noOverlap);
      noOverlap.pipe(partialOverlap);
      partialOverlap.pipe(properSubset);
    });

    it('allows one-way primitive-family widens on pipe(bus)', () => {
      const src = new Bus<{
        status: 'a' | 'b';
        flag: true;
        count: 1 | 2;
      }>();
      const wider = new Bus<{
        status: string;
        flag: boolean;
        count: number;
      }>();

      src.pipe(wider);
    });

    it('rejects the unsafe reverse of a primitive-family widen on pipe(bus)', () => {
      const src = new Bus<{
        status: string;
        flag: boolean;
        count: number;
      }>();
      const narrower = new Bus<{
        status: 'a' | 'b';
        flag: true;
        count: 1 | 2;
      }>();

      // @ts-expect-error string/boolean/number must not narrow onto literal unions
      src.pipe(narrower);
    });

    it('still requires exact match for object payloads on pipe(bus)', () => {
      const src = new Bus<{item: {id: 'a'}}>();
      const wider = new Bus<{item: {id: string}}>();

      // @ts-expect-error object payloads are not in the primitive-family carve-out
      src.pipe(wider);
    });

    it('pipe(bus) returns the concrete downstream bus type, including subclasses', () => {
      class DerivedBus<M extends EventMap> extends Bus<M> {
        public relayLeaf(): void {
          return;
        }
      }

      const src = new Bus<Narrow>();
      const derived = new DerivedBus<Narrow>();
      const chained = src.pipe(derived);
      expectType<DerivedBus<Narrow>>(chained);
      chained.relayLeaf();
    });

    it('pipe(bus) returns the downstream Bus', () => {
      const src = new Bus<Narrow>();
      const dst = new Bus<Narrow>();
      const chained = src.pipe(dst);

      expectType<Bus<Narrow>>(chained);
    });

    it('rejects a hand-rolled surface duck type as a Bus downstream', () => {
      const bus = new Bus<Narrow>();
      const duck = {
        on: bus.on.bind(bus),
        once: bus.once.bind(bus),
        any: bus.any.bind(bus),
        next: bus.next.bind(bus),
        scan: bus.scan.bind(bus),
        pipe: bus.pipe.bind(bus),
        unpipe: bus.unpipe.bind(bus),
        emit: bus.emit.bind(bus),
        destroy: bus.destroy.bind(bus)
      };

      // @ts-expect-error bus-to-bus piping requires a Bus instance, not a surface duck type
      const target: Bus<Narrow> = duck;
      expectType<typeof duck>(duck);
    });

    it('chains pipe(bus) through the returned downstream bus', () => {
      class DerivedBus<M extends EventMap> extends Bus<M> {}

      const a = new Bus<Narrow>();
      const b = new DerivedBus<Narrow>();
      const c = new Bus<Narrow>();

      expectType<DerivedBus<Narrow>>(a.pipe(b));
      expectType<Bus<Narrow>>(a.pipe(b).pipe(c));
    });

  });

  describe('#hook', () => {
    interface Narrow {
      foo: number;
      bar: string;
    }
    interface Wide {
      foo: number;
      bar: string;
      baz: boolean;
    }

    it('accepts assignment of Bus<Wide> to MonitoringSurface<Narrow> for hooks', () => {
      const wide = new Bus<Wide>();
      const monitor: MonitoringSurface<Narrow> = wide;

      monitor.hook('didAddListener', event => {
        expectType<LifecycleSubjectEvent<Narrow>>(event);
        expectType<keyof Narrow | typeof WILDCARD | string>(event);
      });
    });

    it('listener lifecycle hook accepts undeclared event keys', () => {
      const narrow: MonitoringSurface<Narrow> = new Bus<Wide>();

      narrow.hook(Lifecycle.didAddListener, event => {
        expectType<LifecycleSubjectEvent<Narrow>>(event);
        expectType<keyof Narrow | typeof WILDCARD | string>(event);
      });
      narrow.hook('willRemoveListener', event => {
        expectType<LifecycleSubjectEvent<Narrow>>(event);
      });
    });

    it('listener lifecycle hook rejects Narrow only handler', () => {
      const narrow: MonitoringSurface<Narrow> = new Bus<Wide>();

      // @ts-expect-error hook handlers must accept undeclared event keys on a narrowed view
      narrow.hook('didAddListener', (event: keyof Narrow) => undefined);
    });

    it('error hook accepts undeclared event keys', () => {
      const narrow: MonitoringSurface<Narrow> = new Bus<Wide>();

      narrow.hook('error', ({error, event}) => {
        expectType<Error>(error);
        expectType<LifecycleSubjectEvent<Narrow> | Lifecycle>(event);
      });
    });

    it('error hook rejects Narrow only event field', () => {
      const narrow: MonitoringSurface<Narrow> = new Bus<Wide>();

      // @ts-expect-error error hook must accept undeclared event keys on a narrowed view
      narrow.hook('error', ({event}: {error: Error, event: keyof Narrow}) => undefined);
    });

    it('void lifecycle hooks unchanged', () => {
      const bus = new Bus<TestEventMap>();

      bus.hook('active', () => undefined);
      bus.hook('willDestroy', () => undefined);
      bus.hook(Lifecycle.willActivate, () => undefined);
    });
  });

  describe('listener introspection', () => {
    it('accepts valid event keys and return types', () => {
      const bus = new Bus<TestEventMap>();

      expectType<boolean>(bus.hasListeners());
      expectType<boolean>(bus.hasListeners({scope: ListenerScope.ANY}));
      expectType<boolean>(bus.hasListeners({includeIncognito: true}));
      expectType<number>(bus.getListenerCount());
      expectType<number>(bus.getListenerCount({scope: ListenerScope.OWN}));
      expectType<number>(bus.getListenerCount({includeIncognito: true, scope: ListenerScope.OWN}));
      expectType<ListenerSet>(bus.getListeners());
      expectType<ListenerSet>(bus.getListeners({scope: ListenerScope.DOWNSTREAM}));
      expectType<number>(bus.getEventCount());

      expectType<boolean>(bus.hasListenersFor('foo'));
      expectType<boolean>(bus.hasListenersFor('foo', {scope: ListenerScope.ANY}));
      expectType<boolean>(bus.hasListenersFor('foo', {includeIncognito: true}));
      expectType<number>(bus.getListenerCountFor('bar', {scope: ListenerScope.OWN}));
      expectType<ListenerSet>(bus.getListenersFor('baz'));
      expectType<ListenerSet>(bus.getListenersFor('baz', {scope: ListenerScope.DOWNSTREAM}));
      expectType<ListenerSet>(bus.getListenersFor(WILDCARD));

      bus.forEach((event, handlers) => {
        expectType<EventKeys<TestEventMap> | typeof WILDCARD>(event);
        expectType<ListenerSet>(handlers);
      });
      bus.forEach((event, handlers) => {
        expectType<EventKeys<TestEventMap> | typeof WILDCARD>(event);
        expectType<ListenerSet>(handlers);
      }, {scope: ListenerScope.ANY});
      bus.forEach(() => undefined, {includeIncognito: true});
    });

    it('rejects unknown event on get listeners for', () => {
      const bus = new Bus<TestEventMap>();
      // @ts-expect-error 'qux' is not a key of TestEventMap
      bus.getListenersFor('qux', {scope: ListenerScope.ANY});
    });

    it('rejects unknown event on get listener count for', () => {
      const bus = new Bus<TestEventMap>();
      // @ts-expect-error 'qux' is not a key of TestEventMap
      bus.getListenerCountFor('qux', {scope: ListenerScope.OWN});
    });

    it('rejects unknown event on has listeners for', () => {
      const bus = new Bus<TestEventMap>();
      // @ts-expect-error 'qux' is not a key of TestEventMap
      bus.hasListenersFor('qux', {scope: ListenerScope.DOWNSTREAM});
    });

    it('IntrospectionSurface view accepts known events', () => {
      const surface: IntrospectionSurface<TestEventMap> = new Bus<TestEventMap>();

      surface.getListenersFor('foo');
      surface.getListenerCountFor('bar', {scope: ListenerScope.OWN});
      surface.hasListenersFor('baz', {scope: ListenerScope.DOWNSTREAM});
      surface.forEach((event, handlers) => {
        expectType<EventKeys<TestEventMap> | typeof WILDCARD>(event);
        expectType<ListenerSet>(handlers);
      });
    });

    it('SubscriptionSurface view accepts known events', () => {
      const surface: SubscriptionSurface<TestEventMap> = new Bus<TestEventMap>();

      surface.on('foo', payload => expectType<number>(payload));
      surface.once('bar', payload => expectType<string>(payload));
    });
  });

  describe('variance', () => {
    interface Narrow {
      foo: number;
      bar: string;
    }
    interface Wide {
      foo: number;
      bar: string;
      baz: boolean;
    }

    class NarrowSurface implements
      ControlSurface<Narrow>,
      SubscriptionSurface<Narrow>,
      IntrospectionSurface<Narrow>,
      MonitoringSurface<Narrow> {
      private readonly bus = new Bus<Wide>();

      public get name() {
        return this.bus.name;
      }
      public on: SubscriptionSurface<Narrow>['on'] = this.bus.on;
      public off: SubscriptionSurface<Narrow>['off'] = this.bus.off;
      public hook = this.bus.hook;
      public once: SubscriptionSurface<Narrow>['once'] = this.bus.once;
      public any: SubscriptionSurface<Narrow>['any'] = this.bus.any;
      public next: SubscriptionSurface<Narrow>['next'] = this.bus.next;
      public scan: SubscriptionSurface<Narrow>['scan'] = this.bus.scan;
      public tap: SubscriptionSurface<Narrow>['tap'] = this.bus.tap;
      public pipe: SubscriptionSurface<Narrow>['pipe'] = this.bus.pipe;
      public unpipe = this.bus.unpipe;
      public monitor = this.bus.monitor;
      public get active() { return this.bus.active; }
      public hasListeners = this.bus.hasListeners;
      public getListenerCount = this.bus.getListenerCount;
      public getListeners = this.bus.getListeners;
      public getEventCount = this.bus.getEventCount;
      public hasListenersFor = this.bus.hasListenersFor;
      public getListenerCountFor = this.bus.getListenerCountFor;
      public getListenersFor = this.bus.getListenersFor;
      public forEach = this.bus.forEach;
      public destroy = this.bus.destroy;
      public emit = this.bus.emit;
    }

    it('accepts assignment of Bus<Wide> to SubscriptionSurface<Narrow>', () => {
      const evaluator: Scanner.Evaluator<boolean, Narrow> = resolve => {
        resolve(true);
      };

      const wide = new Bus<Wide>();
      const narrowed: SubscriptionSurface<Narrow> = wide;

      narrowed.on('foo', payload => expectType<number>(payload));
      narrowed.once('bar', payload => expectType<string>(payload));
      narrowed.any(['foo', 'bar'], (event, payload) => {
        expectType<keyof Narrow>(event);
        expectType<Narrow[keyof Narrow]>(payload);
      });
      narrowed.scan('foo', evaluator);
      narrowed.next('foo').then(result => {
        expectType<'foo'>(result.event);
        expectType<number>(result.payload);
      });
    });

    it('accepts assignment of Bus<Wide> to IntrospectionSurface<Narrow>', () => {
      const wide = new Bus<Wide>();
      const narrowed: IntrospectionSurface<Narrow> = wide;

      expectType<number>(narrowed.getListenerCountFor('foo', {scope: ListenerScope.ANY}));
      expectType<ListenerSet>(narrowed.getListenersFor('bar', {scope: ListenerScope.OWN}));
    });

    it('accepts assignment of Bus<Wide> to MonitoringSurface<Narrow>', () => {
      const wide = new Bus<Wide>();
      const narrowed: MonitoringSurface<Narrow> = wide;

      narrowed.monitor(active => expectType<boolean>(active));
      expectType<boolean>(narrowed.active);
      narrowed.hook(Lifecycle.didAddListener, event => {
        expectType<LifecycleSubjectEvent<Narrow>>(event);
      });
    });

    it('accepts assignment of Bus<Wide> to ControlSurface<Narrow>', () => {
      const wide = new Bus<Wide>();
      const narrowed: ControlSurface<Narrow> = wide;

      narrowed.emit('foo', 1);
      narrowed.destroy();
    });

    it('NarrowSurface composition satisfies SubscriptionSurface<Narrow>', () => {
      const evaluator: Scanner.Evaluator<boolean, Narrow> = resolve => {
        resolve(true);
      };

      const narrow = new NarrowSurface();
      expectType<SubscriptionSurface<Narrow>>(narrow);
      narrow.on('foo', payload => expectType<number>(payload));
      narrow.once('bar', payload => expectType<string>(payload));
      narrow.any(['foo', 'bar'], (event, payload) => {
        expectType<keyof Narrow>(event);
        expectType<Narrow[keyof Narrow]>(payload);
      });
      narrow.scan('foo', evaluator);
      narrow.next('foo').then(result => {
        expectType<'foo'>(result.event);
        expectType<number>(result.payload);
      });
    });

    it('NarrowSurface composition satisfies IntrospectionSurface<Narrow>', () => {
      const narrow = new NarrowSurface();
      expectType<IntrospectionSurface<Narrow>>(narrow);
      expectType<number>(narrow.getListenerCountFor('foo', {scope: ListenerScope.ANY}));
      expectType<ListenerSet>(narrow.getListenersFor('bar', {scope: ListenerScope.OWN}));
    });

    it('NarrowSurface composition satisfies MonitoringSurface<Narrow>', () => {
      const narrow = new NarrowSurface();
      expectType<MonitoringSurface<Narrow>>(narrow);
      narrow.monitor(active => expectType<boolean>(active));
      expectType<boolean>(narrow.active);
      narrow.hook('didAddListener', event => {
        expectType<LifecycleSubjectEvent<Narrow>>(event);
      });
    });

    it('NarrowSurface composition satisfies ControlSurface<Narrow>', () => {
      const narrow = new NarrowSurface();
      expectType<ControlSurface<Narrow>>(narrow);
      narrow.emit('foo', 1);
      narrow.destroy();
    });

    it('NarrowSubscriptionSurface rejects unknown event', () => {
      const narrow: SubscriptionSurface<Narrow> = new Bus<Wide>();
      const evaluator: Scanner.Evaluator<boolean, Narrow> = resolve => {
        resolve(true);
      };

      // @ts-expect-error 'baz' is not in the Narrow view, even though the underlying bus is Wide
      narrow.on('baz', () => undefined);
      // @ts-expect-error 'baz' is not in the Narrow view, even though the underlying bus is Wide
      narrow.once('baz', () => undefined);
      // @ts-expect-error 'baz' is not in the Narrow view, even though the underlying bus is Wide
      narrow.any(['baz'], () => undefined);
      // @ts-expect-error 'baz' is not in the Narrow view, even though the underlying bus is Wide
      narrow.scan('baz', evaluator);
      // @ts-expect-error 'baz' is not in the Narrow view, even though the underlying bus is Wide
      narrow.next('baz');
    });

    it('NarrowIntrospectionSurface rejects unknown event', () => {
      const narrow: IntrospectionSurface<Narrow> = new Bus<Wide>();

      // @ts-expect-error 'baz' is not in the Narrow view, even though the underlying bus is Wide
      narrow.getListenersFor('baz', {scope: ListenerScope.ANY});
      // @ts-expect-error 'baz' is not in the Narrow view, even though the underlying bus is Wide
      narrow.getListenerCountFor('baz', {scope: ListenerScope.ANY});
    });

    it('pipe(bus) returns the downstream Bus instance', () => {
      const narrow: SubscriptionSurface<Narrow> = new Bus<Wide>();
      const wideBus = new Bus<Wide>();

      const downstream = narrow.pipe(wideBus);
      expectType<Bus<Wide>>(downstream);
      downstream.on('foo', payload => expectType<number>(payload));
      downstream.on('baz', payload => expectType<boolean>(payload));
    });

    it('narrows payload by discriminating event in a function sink', () => {
      const narrow: SubscriptionSurface<Narrow> = new Bus<Wide>();

      narrow.tap((message: PipedMessage<Narrow>) => {
        expectType<keyof Narrow>(message.event);
        if (message.event === 'foo') {
          expectType<number>(message.payload);
          // @ts-expect-error 'foo' carries a number payload, not a string
          expectType<string>(message.payload);
        } else if (message.event === 'bar') {
          expectType<string>(message.payload);
          // @ts-expect-error 'bar' carries a string payload, not a number
          expectType<number>(message.payload);
        }
      });
    });

    it('accepts a message sink narrowed to a subset of the source events', () => {
      const bus = new Bus<Wide>();

      // attaching a foo|bar-only sink to a wider bus is the same wide->narrow
      // bivariance the read surfaces rely on; payloads stay correlated per branch.
      bus.tap((message: PipedMessage<Narrow>) => {
        if (message.event === 'foo') {
          expectType<number>(message.payload);
        } else if (message.event === 'bar') {
          expectType<string>(message.payload);
        }
      });
    });

    it('supports the documented discriminated pipe sink', () => {
      const bus = new Bus<{foo: string; bar: number}>();
      bus.tap((message: PipedMessage<{foo: string; bar: number}>) => {
        if (message.event === 'foo') {
          message.payload.toUpperCase();
        } else if (message.event === 'bar') {
          message.payload.toString(2);
        } else {
          // unknown event/payload, ignore
        }
      });
    });

    it('types payload as the correlated union until the event is discriminated', () => {
      const bus = new Bus<{foo: string; bar: number}>();

      bus.tap((message: PipedMessage<{foo: string; bar: number}>) => {
        expectType<string | number>(message.payload);
        // @ts-expect-error a string-only method can't be called on string | number
        message.payload.toUpperCase();
        if (message.event === 'foo') {
          expectType<string>(message.payload);
        }
      });
    });

    it('keeps tap handlers correlated when piping wide into narrow', () => {
      const wide = new Bus<{foo: string, bar: string, baz: number}>();
      const narrow = new Bus<{foo: string, bar: string}>();

      type NarrowMessage = PipedMessage<{foo: string; bar: string}>;
      const downstream = wide.pipe(narrow);
      expectType<Bus<{foo: string; bar: string}>>(downstream);

      narrow.tap((message: NarrowMessage) => {
        if (message.event === 'foo') {
          expectType<string>(message.payload);
        } else if (message.event === 'bar') {
          expectType<string>(message.payload);
        }
      });

      downstream.tap((message: NarrowMessage) => {
        if (message.event === 'foo') {
          expectType<string>(message.payload);
        } else if (message.event === 'bar') {
          expectType<string>(message.payload);
        }
      });
    });

    it('pipe rejects downstream with incompatible shared payloads', () => {
      const narrow: SubscriptionSurface<Narrow> = new Bus<Wide>();

      interface Incompatible {
        foo: string;
        bar: string;
      }

      // @ts-expect-error Narrow.foo is number; Incompatible.foo is string
      narrow.pipe(new Bus<Incompatible>());
    });

    it('TapHandler<Narrow> rejects incompatible sink', () => {
      const narrow: SubscriptionSurface<Narrow> = new Bus<Wide>();

      interface WrongEvents {
        qux: number;
      }

      const wrongSink: TapHandler<WrongEvents> = () => undefined;

      // @ts-expect-error sink must accept Narrow event keys and payloads
      narrow.tap(wrongSink);
    });

    it('rejects a function sink whose events are disjoint from the source map', () => {
      const bus = new Bus<Wide>();
      interface Disjoint {
        qux: number;
      }
      // @ts-expect-error a Disjoint sink shares no events with Wide
      bus.tap((message: PipedMessage<Disjoint>) => {
        expectType<'qux'>(message.event);
      });
    });

    it('narrows payload across every event of the source map', () => {
      const bus = new Bus<Wide>();
      bus.tap((message: PipedMessage<Wide>) => {
        expectType<keyof Wide>(message.event);
        expectType<number | string | boolean>(message.payload);
        switch (message.event) {
          case 'foo':
            expectType<number>(message.payload);
            break;
          case 'bar':
            expectType<string>(message.payload);
            break;
          case 'baz':
            expectType<boolean>(message.payload);
            break;
          default:
            expectType<never>(message);
        }
      });
    });

    it('piping into a narrower downstream returns that downstream bus', () => {
      const wide = new Bus<Wide>();
      const narrow = new Bus<Narrow>();

      // pipe returns the downstream bus itself, identical to using narrow directly;
      // source-only events are not surfaced on it.
      const downstream = wide.pipe(narrow);
      expectType<Bus<Narrow>>(downstream);
      downstream.on('foo', payload => expectType<number>(payload));
      downstream.on('bar', payload => expectType<string>(payload));
      // @ts-expect-error 'baz' is not in the Narrow downstream's event map
      downstream.on('baz', () => undefined);
    });
  });

  // these cover generic + variance usage: `Bus` wrapped, subclassed, or exposed
  // over an event map that is still an open generic type parameter.
  describe('generics', () => {
    interface Narrow {
      foo: number;
      bar: string;
    }
    interface Wide {
      foo: number;
      bar: string;
      baz: boolean;
    }

    // a generic subclass (`class Test<M> extends Bus<M>`) must keep every surface
    // method correlated over the still-open event map `M` — the motivation for
    // the overloaded `emit`.
    it('keeps the full surface correlated in a generic Bus subclass', () => {
      class Test<M extends EventMap> extends Bus<M> {
        public relay<K extends EventKeys<M>>(event: K, payload: M[K]): boolean {
          return this.emit(event, payload);
        }

        public relayVoid<K extends VoidEventKeys<M>>(event: K): boolean {
          return this.emit(event, null);
        }

        public listen<K extends SubscribableEventKeys<M>>(
          event: K,
          handler: EventHandler<M, K>
        ): Subscription {
          return this.on(event, handler);
        }

        public relayAll(sink: TapHandler<M>): Subscription {
          return this.tap(sink);
        }
      }

      const bus = new Test<Wide>();
      expectType<boolean>(bus.relay('foo', 1));
      bus.listen('bar', payload => expectType<string>(payload));
      bus.emit('baz', true);
      // @ts-expect-error 'foo' still carries a number payload through the subclass
      bus.relay('foo', 'nope');
    });

    // a class can build a Bus over a mapped event map and re-expose surface
    // methods sourced from it, emitting with `(event: TEvent, update: TUpdate)`.
    it('supports a generic mapped event map with surface methods sourced from the bus', () => {
      class Test<TEvent extends string, TUpdate> {
        private readonly bus = new Bus<{[K in TEvent]: TUpdate}>();

        public readonly on: SubscriptionSurface<{[K in TEvent]: TUpdate}>['on'] = this.bus.on;
        public readonly any: SubscriptionSurface<{[K in TEvent]: TUpdate}>['any'] = this.bus.any;
        public readonly pipe: SubscriptionSurface<{[K in TEvent]: TUpdate}>['pipe'] = this.bus.pipe;
        public readonly tap: SubscriptionSurface<{[K in TEvent]: TUpdate}>['tap'] = this.bus.tap;
        public readonly unpipe: SubscriptionSurface<{[K in TEvent]: TUpdate}>['unpipe'] = this.bus.unpipe;

        public emit(event: TEvent, update: TUpdate): boolean {
          return this.bus.emit(event, update);
        }
      }

      const instance = new Test<'change' | 'reset', {value: number}>();
      instance.on('change', payload => expectType<{value: number}>(payload));
      instance.emit('reset', {value: 2});
      instance.tap((message: PipedMessage<{change: {value: number}; reset: {value: number}}>) => {
        expectType<'change' | 'reset'>(message.event);
        expectType<{value: number}>(message.payload);
      });
      // @ts-expect-error 'change' carries the update payload, not a string
      instance.emit('change', 'nope');
    });

    // a class can expose a subset of the surface (via `Pick`) backed by a generic
    // bus, assigning the bus's own methods to satisfy the picked surface.
    it('exposes a Pick of the surface backed by a generic bus', () => {
      interface ITest<M extends EventMap> extends Pick<
        SubscriptionSurface<M>,
        'on' | 'any' | 'pipe' | 'unpipe'
      > {
        readonly name: string;
      }

      class Test<M extends EventMap> implements ITest<M> {
        private readonly bus = new Bus<M>();
        public readonly name = 'test';
        public readonly on: SubscriptionSurface<M>['on'] = this.bus.on;
        public readonly any: SubscriptionSurface<M>['any'] = this.bus.any;
        public readonly pipe: SubscriptionSurface<M>['pipe'] = this.bus.pipe;
        public readonly unpipe: SubscriptionSurface<M>['unpipe'] = this.bus.unpipe;
      }

      const instance: ITest<Narrow> = new Test<Narrow>();
      instance.on('foo', payload => expectType<number>(payload));
    });

    // an open index-signature map (`{[event: string]: any}`) accepts arbitrary
    // string events with `any` payloads.
    it('allows arbitrary string events on an open index-signature map', () => {
      type OpenEventMap = {[event: string]: any};
      const bus = new Bus<OpenEventMap>();

      bus.on('anything', payload => expectType<any>(payload));
      bus.emit('anything', 42);
      bus.emit('whatever', {a: 1});
      bus.tap((message: PipedMessage<{foo: string; bar: number}>) => {
        expectType<string | number>(message.event);
        expectType<any>(message.payload);
      });
    });

    // a helper can accept a `SubscriptionSurface<M>` and a concrete `Bus` can be
    // passed in (Bus implements the surface), correlating the handler payload
    // through the generic key parameter.
    it('accepts a Bus where a generic SubscriptionSurface parameter is expected', () => {
      function observe<M extends EventMap, K extends SubscribableEventKeys<M>>(
        surface: SubscriptionSurface<M>,
        event: K,
        handler: EventHandler<M, K>
      ): Subscription {
        return surface.on(event, handler);
      }

      const bus = new Bus<Wide>();
      observe(bus, 'foo', payload => expectType<number>(payload));
      observe(bus, 'baz', payload => expectType<boolean>(payload));
    });

    // a generic subclass must accept wildcard tap handlers — nullary
    // (`tap(() => …)`), message (`tap((message) => …)`), and fully-typed
    // function references — over its open map.
    it('accepts nullary, message, and untyped sinks in a generic subclass', () => {
      class Test<M extends EventMap> extends Bus<M> {
        public relayAll(sink: TapHandler<M>): Subscription {
          return this.tap(sink);
        }
      }
      const instance = new Test<Wide>();

      instance.tap((): void => undefined);
      instance.tap((message: PipedMessage<Wide>) => {
        expectType<keyof Wide>(message.event);
        expectType<number | string | boolean>(message.payload);
      });
      const anySink: (...args: any[]) => void = () => undefined;
      instance.tap(anySink);
      instance.relayAll(anySink);
    });

    // limitation: downstream piping (bus-into-bus) needs a concrete event map. under
    // an abstract `M` the downstream overload's payload-overlap check can't be
    // evaluated, and a `Bus<M>` is not a function, so no overload matches.
    // concrete-map downstream piping is exercised in the `variance` specs above.
    it('cannot resolve downstream piping over an abstract event map', () => {
      function bridge<M extends EventMap>(src: Bus<M>, dst: Bus<M>): void {
        // @ts-expect-error downstream piping requires a concrete map, not an abstract M
        src.pipe(dst);
      }
      expectType<typeof bridge>(bridge);

      // ...but with a concrete map the downstream overload resolves and returns the
      // downstream bus itself.
      const from = new Bus<Wide>();
      const to = new Bus<Wide>();
      const chained = from.pipe(to);
      expectType<Bus<Wide>>(chained);
      chained.on('foo', payload => expectType<number>(payload));
    });
  });

  // these model a layered interface tree: a base interface exposing a
  // `Pick` of the surface over an extensible event map, a generic sub-interface
  // that adds its own fixed events, and concretions that back the interface with
  // a `Bus`. They cover the three recurring pain points such trees hit.
  describe('layered interface tree composition', () => {
    // the fixed events every node carries
    interface BaseEvents {
      baseMsg: string;
      baseSignal: void;
    }

    // a base interface: a `Pick` of a narrower surface over an extensible map
    interface Base<T extends object = object> extends Pick<
      SubscriptionSurface<BaseEvents & T>,
      'on' | 'pipe' | 'tap' | 'next' | 'scan'
    > {
      readonly id: string;
    }

    // a sub-interface adding its own fixed events, still generic over incoming events
    interface ExtensionEvents {
      extSignal: void;
      extData: {success: boolean};
    }
    interface Extension<TIncoming extends object> extends Base<ExtensionEvents & TIncoming> {
      activate(): void;
    }

    interface LeafEvents {
      leafData: number;
    }

    // pain point 1: a concretion whose backing bus carries a superset of the
    // interface's event map still satisfies the (narrower) interface.
    it('a superset concretion satisfies a narrower node interface', () => {
      class Test implements Base<LeafEvents> {
        private readonly bus = new Bus<BaseEvents & LeafEvents & {internalOnly: boolean}>();
        public readonly id = 'x';
        public readonly on: SubscriptionSurface<BaseEvents & LeafEvents>['on'] = this.bus.on;
        public readonly pipe: SubscriptionSurface<BaseEvents & LeafEvents>['pipe'] = this.bus.pipe;
        public readonly tap: SubscriptionSurface<BaseEvents & LeafEvents>['tap'] = this.bus.tap;
        public readonly next: SubscriptionSurface<BaseEvents & LeafEvents>['next'] = this.bus.next;
        public readonly scan: SubscriptionSurface<BaseEvents & LeafEvents>['scan'] = this.bus.scan;
      }

      const conn: Base<LeafEvents> = new Test();
      conn.on('baseMsg', payload => expectType<string>(payload));
      conn.on('leafData', payload => expectType<number>(payload));
      // @ts-expect-error 'internalOnly' is backing-bus-only, not on the exposed interface map
      conn.on('internalOnly', () => undefined);
    });

    // pain point 2: a subclass generic over its incoming events is assignable to
    // the base interface, and its surface methods (on/pipe) work.
    it('a generic extension node is assignable to the base interface', () => {
      class Test<TIncoming extends object> implements Extension<TIncoming> {
        private readonly bus = new Bus<BaseEvents & ExtensionEvents & TIncoming>();
        public readonly id = 'x';
        public readonly on: SubscriptionSurface<BaseEvents & ExtensionEvents & TIncoming>['on'] = this.bus.on;
        public readonly pipe: SubscriptionSurface<BaseEvents & ExtensionEvents & TIncoming>['pipe'] = this.bus.pipe;
        public readonly tap: SubscriptionSurface<BaseEvents & ExtensionEvents & TIncoming>['tap'] = this.bus.tap;
        public readonly next: SubscriptionSurface<BaseEvents & ExtensionEvents & TIncoming>['next'] = this.bus.next;
        public readonly scan: SubscriptionSurface<BaseEvents & ExtensionEvents & TIncoming>['scan'] = this.bus.scan;
        public activate(): void {
          return undefined;
        }
      }

      const conn = new Test<LeafEvents>();
      const base: Base<ExtensionEvents & LeafEvents> = conn;
      base.on('baseMsg', payload => expectType<string>(payload));
      base.on('leafData', payload => expectType<number>(payload));
      conn.tap((message: PipedMessage<BaseEvents & ExtensionEvents & LeafEvents>) => {
        if (message.event === 'baseMsg') {
          expectType<string>(message.payload);
        }
      });
    });

    // pain point 3: a generic base can emit a constraint-guaranteed event — fixed,
    // void, or forwarded by key — over its own open map, with no casts.
    it('emits constraint-guaranteed events from a generic base', () => {
      abstract class Test<T extends BaseEvents> {
        protected readonly bus = new Bus<T>();
        public emitRootData(status: T['baseMsg']): boolean {
          return this.bus.emit('baseMsg', status);
        }
        public emitRootSignal(): boolean {
          return this.bus.emit('baseSignal', null);
        }
        public forward<K extends EventKeys<T>>(event: K, payload: T[K]): boolean {
          return this.bus.emit(event, payload);
        }
      }
      expectType<typeof Test>(Test);
    });

    // pain point 3 (boundary): when the bus map is `Fixed & TGeneric` — an
    // intersection with an *open* generic — `M[K]` becomes a deferred type
    // (e.g. `string & TGeneric['rootData']`), so a plain literal payload
    // can't be emitted directly. This is the TS limitation behind casting to
    // `any`. Both hack-free alternatives below compile.
    it('documents the intersection-map emit limitation and its workarounds', () => {
      class Intersected<TIncoming extends object> {
        private readonly bus = new Bus<ExtensionEvents & BaseEvents & TIncoming>();
        public announce(status: (ExtensionEvents & BaseEvents & TIncoming)['baseMsg']): void {
          // @ts-expect-error `M[K]` is deferred over the open generic, so a literal won't fit
          this.bus.emit('baseMsg', 'ok');
          // a value already typed as `M[K]` is accepted
          this.bus.emit('baseMsg', status);
        }
      }
      expectType<typeof Intersected>(Intersected);

      // be generic over the *whole* map (constrained to include the fixed
      // events); payloads flow through parameters typed `M[K]`.
      class WholeMap<M extends ExtensionEvents & BaseEvents> {
        private readonly bus = new Bus<M>();
        public announce(status: M['baseMsg'], child: M['extData']): void {
          this.bus.emit('baseMsg', status);
          this.bus.emit('extData', child);
          this.bus.emit('extSignal', null);
        }
        // generic-key forwarding works here because the bus map is a *naked* type
        // parameter: `[K, M[K]]` keeps its correlation, so the sound `emit`
        // accepts the pair (while still rejecting an uncorrelated union pair).
        public forward<K extends EventKeys<M>>(event: K, payload: M[K]): boolean {
          return this.bus.emit(event, payload);
        }
      }
      expectType<typeof WholeMap>(WholeMap);
    });

    // pain point 3 (resolved): a *flattening* merge (overlapping keys take
    // `Base`) instead of an intersection lets fixed-key literals emit without
    // casts — but only when the map is shaped so a fixed key never resolves
    // *through* a layer that folds in the open generic's keyset. It's the
    // position of the generic, not the merge operator, that decides this.
    it('emits fixed-key literals from a generic base via a position-aware flattening merge', () => {
      // `Merge` is the public flattening merge: overlaps take `Base`, unlike
      // `Base & Ext` which intersects (and thus defers) each payload.

      // wrong shape: the open generic is folded into an inner merge layer, so a
      // fixed key resolving through it stays deferred — the same failure as the
      // intersection case. Only keys sitting in the outer, fully-concrete Base
      // escape.
      class NestedGeneric<TIncoming extends object> {
        private readonly bus = new Bus<Merge<BaseEvents, Merge<ExtensionEvents, TIncoming>>>();
        public announce(): void {
          // rootData sits in the outer, concrete Base -> resolves
          this.bus.emit('baseMsg', 'ok');
          // @ts-expect-error extData resolves through the inner merge, whose keyset folds in the open generic, so `M[K]` is deferred
          this.bus.emit('extData', {success: true});
        }
      }
      expectType<typeof NestedGeneric>(NestedGeneric);

      // right shape: flatten every *concrete* map into one fixed map first (no
      // generic involved, so it resolves fully), then merge the open generic as
      // the sole, outermost Ext. Every fixed key now resolves against the
      // concrete Base before the generic keyset is consulted, so literals emit
      // with no cast.
      type FixedEvents = Merge<BaseEvents, ExtensionEvents>;
      class OuterGeneric<TIncoming extends object> {
        private readonly bus = new Bus<Merge<FixedEvents, TIncoming>>();
        public announce(): void {
          this.bus.emit('baseMsg', 'ok');
          this.bus.emit('extData', {success: true});
          this.bus.emit('baseSignal', null);
          this.bus.emit('extSignal', null);
        }
        // generic-key forwarding over a Merge map: `[K, M[K]]` shares `K`.
        public forward<K extends Exclude<Extract<keyof TIncoming, string>, keyof FixedEvents>>(
          event: K,
          payload: Merge<FixedEvents, TIncoming>[K]
        ): boolean {
          return this.bus.emit(event, payload);
        }
      }

      const conn = new OuterGeneric<LeafEvents>();
      conn.announce();
    });
  });

});
