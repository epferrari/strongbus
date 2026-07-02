import {Bus} from './strongbus';
import {Scanner} from './scanner';
import {WILDCARD} from './types/events';
import {Lifecycle, type LifecycleSubjectEvent} from './types/lifecycle';
import {ListenerScope} from './types/listenerScope';
import type {EventSink, PipeSink} from './types/eventHandlers';
import type {ListenerSet} from './types/listenerRegistry';
import type {ControlSurface} from './types/surfaces/controlSurface';
import type {IntrospectionSurface} from './types/surfaces/introspectionSurface';
import type {MonitoringSurface} from './types/surfaces/monitoringSurface';
import type {SubscriptionSurface} from './types/surfaces/subscriptionSurface';
import type {EventKeys} from './types/utility';

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
      bus.scan({evaluator, trigger: 'qux'});
    });

    it('result type drives evaluator and promise', () => {
      const bus = new Bus<TestEventMap>();
      const result = bus.scan<number>('foo', resolve => {
        resolve(1);
        resolve.resolve(2);
      });
      result.then(value => expectType<number>(value));
      bus.scan<number>({
        evaluator: resolve => {
          resolve(1);
          resolve.resolve(2);
        },
        trigger: 'foo'
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
      expectType<number>(bus.getListenerCount());
      expectType<number>(bus.getListenerCount({scope: ListenerScope.OWN}));
      expectType<ListenerSet>(bus.getListeners());
      expectType<ListenerSet>(bus.getListeners({scope: ListenerScope.DELEGATE}));
      expectType<number>(bus.getEventCount());

      expectType<boolean>(bus.hasListenersFor('foo'));
      expectType<boolean>(bus.hasListenersFor('foo', {scope: ListenerScope.ANY}));
      expectType<number>(bus.getListenerCountFor('bar', {scope: ListenerScope.OWN}));
      expectType<ListenerSet>(bus.getListenersFor('baz'));
      expectType<ListenerSet>(bus.getListenersFor('baz', {scope: ListenerScope.DELEGATE}));
      expectType<ListenerSet>(bus.getListenersFor(WILDCARD));

      bus.forEach((event, handlers) => {
        expectType<EventKeys<TestEventMap> | typeof WILDCARD>(event);
        expectType<ListenerSet>(handlers);
      });
      bus.forEach((event, handlers) => {
        expectType<EventKeys<TestEventMap> | typeof WILDCARD>(event);
        expectType<ListenerSet>(handlers);
      }, {scope: ListenerScope.ANY});
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
      bus.hasListenersFor('qux', {scope: ListenerScope.DELEGATE});
    });

    it('IntrospectionSurface view accepts known events', () => {
      const surface: IntrospectionSurface<TestEventMap> = new Bus<TestEventMap>();

      surface.getListenersFor('foo');
      surface.getListenerCountFor('bar', {scope: ListenerScope.OWN});
      surface.hasListenersFor('baz', {scope: ListenerScope.DELEGATE});
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
      public hook = this.bus.hook;
      public once: SubscriptionSurface<Narrow>['once'] = this.bus.once;
      public any: SubscriptionSurface<Narrow>['any'] = this.bus.any;
      public next: SubscriptionSurface<Narrow>['next'] = this.bus.next;
      public scan: SubscriptionSurface<Narrow>['scan'] = this.bus.scan;
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
      narrowed.scan({evaluator, trigger: 'foo'});
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
      narrow.scan({evaluator, trigger: 'baz'});
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

    it('PipeSink<Narrow> accepts Bus<Wide>', () => {
      const narrow: SubscriptionSurface<Narrow> = new Bus<Wide>();
      const wideBus = new Bus<Wide>();

      const delegate = narrow.pipe(wideBus);
      expectType<SubscriptionSurface<Wide>>(delegate);
      delegate.on('foo', payload => expectType<number>(payload));
      delegate.on('baz', payload => expectType<boolean>(payload));
    });

    it('narrows payload by discriminating event in a function sink', () => {
      const narrow: SubscriptionSurface<Narrow> = new Bus<Wide>();

      narrow.pipe((event, payload) => {
        expectType<keyof Narrow>(event);
        if (event === 'foo') {
          expectType<number>(payload);
          // @ts-expect-error 'foo' carries a number payload, not a string
          expectType<string>(payload);
        } else if (event === 'bar') {
          expectType<string>(payload);
          // @ts-expect-error 'bar' carries a string payload, not a number
          expectType<number>(payload);
        }
      });
    });

    it('rejects a function sink whose payload type is too narrow for a shared event', () => {
      const bus = new Bus<Narrow>();

      // @ts-expect-error 'bar' carries a string payload, which a number-only sink cannot accept
      bus.pipe((event: 'foo' | 'bar', payload: number) => {
        expectType<number>(payload);
      });
    });

    it('supports the documented discriminated pipe sink', () => {
      const bus = new Bus<{foo: string; bar: number}>();
      bus.pipe((event, payload) => {
        if (event === 'foo') {
          payload.toUpperCase();
        } else if (event === 'bar') {
          payload.toString(2);
        } else {
          // unknown event/payload, ignore
        }
      });
    });

    it('types payload as unknown until the event is discriminated', () => {
      const bus = new Bus<{foo: string; bar: number}>();

      bus.pipe((event, payload) => {
        expectType<unknown>(payload);
        // @ts-expect-error payload is unknown until event is discriminated
        expectType<string>(payload);
        if (event === 'foo') {
          expectType<string>(payload);
        }
      });
    });

    it('keeps pipe sinks sound when a wider source forwards unknown events', () => {
      const wide = new Bus<{foo: string, bar: string, baz: number}>();
      const narrow = new Bus<{foo: string, bar: string}>();

      // piping wide into narrow forwards 'baz' (number) into narrow at runtime.
      // pipe returns the delegate's own surface, so a chained sink is identical
      // to piping on `narrow` directly.
      const surface = wide.pipe(narrow);
      expectType<SubscriptionSurface<{foo: string; bar: string}>>(surface);

      // the following are the same assertions, one over the narrow bus itself, and one over the surface returned from pipe;

      narrow.pipe((event, payload) => {
        // payload is unknown until the event is discriminated...
        // @ts-expect-error payload is unknown until event is discriminated
        payload.toLowerCase();

        // ...and a forwarded 'baz' isn't part of narrow's surface, so it can't
        // be named and simply falls through the known branches rather than being
        // mistyped as a string.
        // @ts-expect-error 'baz' is not part of the delegate's surface
        if (event === 'baz') {
          expectType<unknown>(payload);
        }

        if (event === 'foo') {
          expectType<string>(payload);
        } else if (event === 'bar') {
          expectType<string>(payload);
        }
      });

      surface.pipe((event, payload) => {
        // payload is unknown until the event is discriminated...
        // @ts-expect-error payload is unknown until event is discriminated
        payload.toLowerCase();

        // ...and a forwarded 'baz' isn't part of narrow's surface, so it can't
        // be named and simply falls through the known branches rather than being
        // mistyped as a string.
        // @ts-expect-error 'baz' is not part of the delegate's surface
        if (event === 'baz') {
          expectType<unknown>(payload);
        }

        if (event === 'foo') {
          expectType<string>(payload);
        } else if (event === 'bar') {
          expectType<string>(payload);
        }
      });
    });

    it('PipeSink<Narrow> rejects incompatible delegate', () => {
      const narrow: SubscriptionSurface<Narrow> = new Bus<Wide>();

      interface Incompatible {
        foo: string;
        bar: string;
      }

      // @ts-expect-error delegate emit must accept Narrow payloads for shared events
      narrow.pipe(new Bus<Incompatible>());
    });

    it('PipeSink<Narrow> rejects incompatible sink', () => {
      const narrow: SubscriptionSurface<Narrow> = new Bus<Wide>();

      interface WrongEvents {
        qux: number;
      }

      const wrongSink: PipeSink<WrongEvents> = () => undefined;

      // @ts-expect-error sink must accept Narrow event keys and payloads
      narrow.pipe(wrongSink);
    });

    it('rejects a function sink that omits an event in the source map', () => {
      const bus = new Bus<Wide>();
      // @ts-expect-error a Wide sink must also handle 'baz', which this Narrow-only sink cannot
      bus.pipe((event: keyof Narrow, payload: Narrow[keyof Narrow]) => {
        expectType<keyof Narrow>(event);
      });
    });

    it('narrows payload across every event of the source map', () => {
      const bus = new Bus<Wide>();
      bus.pipe((event, payload) => {
        expectType<keyof Wide>(event);
        expectType<unknown>(payload);
        switch (event) {
          case 'foo':
            expectType<number>(payload);
            break;
          case 'bar':
            expectType<string>(payload);
            break;
          case 'baz':
            expectType<boolean>(payload);
            break;
          default:
            expectType<never>(payload);
        }
      });
    });

    it('piping into a narrower delegate returns the delegate\'s own surface', () => {
      const wide = new Bus<Wide>();
      const narrow = new Bus<Narrow>();

      // pipe returns the delegate's own surface, identical to using narrowBus
      // directly; source-only events are not surfaced on it.
      const surface = wide.pipe(narrow);
      expectType<SubscriptionSurface<Narrow>>(surface);
      surface.on('foo', payload => expectType<number>(payload));
      surface.on('bar', payload => expectType<string>(payload));
      // @ts-expect-error 'baz' is not in the Narrow delegate's event map
      surface.on('baz', () => undefined);
    });
  });

});
