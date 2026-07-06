import {Bus} from './strongbus';
import {Scanner} from './scanner';
import {WILDCARD, type EventMap, type Subscription} from './types/events';
import {Lifecycle, type LifecycleSubjectEvent} from './types/lifecycle';
import {ListenerScope} from './types/listenerScope';
import type {EventHandler, EventSink, PipeSink, PipeMessage} from './types/eventHandlers';
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

    // soundness: a union-typed event key must not pair with a union-typed
    // payload without first discriminating on the event. This is the hole a
    // destructured pipe sink used to slip through -- `(event, payload) =>
    // bus.emit(event, payload)` forwards an *uncorrelated* pair.
    it('rejects an uncorrelated union event/payload pair', () => {
      const bus = new Bus<TestEventMap>();
      const event = 'foo' as 'foo' | 'bar';
      const payload = 1 as number | string;
      // @ts-expect-error the (event, payload) pair is not proven correlated
      bus.emit(event, payload);

      // once discriminated, the correlated pair is accepted
      if (event === 'foo') {
        bus.emit(event, payload as number);
      }
    });

    // the correlation guard must not get in the way of forwarding a *single*
    // generic key: `[K, M[K]]` shares the type parameter, so it stays correlated.
    it('still forwards a single generic key by (event, payload)', () => {
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

  describe('#pipe (function sink)', () => {
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
      bus.pipe((msg) => {
        if (msg.event === 'foo') {
          expectType<number>(msg.payload);
        } else if (msg.event === 'bar') {
          expectType<string>(msg.payload);
        }
      });
    });

    it('forwards a whole message to a same-map bus via forward(dst)', () => {
      const src = new Bus<Narrow>();
      const dst = new Bus<Narrow>();
      src.pipe((msg, forward) => {
        forward(dst); // re-emit the whole correlated message, no cast, no narrowing
      });
    });

    it('supports narrowed side-effect then whole-message forward', () => {
      const src = new Bus<Narrow>();
      const dst = new Bus<Narrow>();
      src.pipe((msg, forward) => {
        if (msg.event === 'foo') {
          msg.payload.toFixed(2);
        }
        forward(dst);
      });
    });

    it('rejects the split 2-arg forward (still guarded by emit)', () => {
      const src = new Bus<Narrow>();
      const dst = new Bus<Narrow>();
      src.pipe((msg) => {
        // @ts-expect-error uncorrelated union event/payload pair
        dst.emit(msg.event, msg.payload);
        // ok if we descriminate first
        if(msg.event === 'foo') {
          dst.emit(msg.event, msg.payload);
        }
      });
    });

    it('forwards a message to a wider or partially-overlapping bus (like pipe(dst))', () => {
      const src = new Bus<Narrow>();
      const noOverlap = new Bus<Other>();
      const partialOverlap = new Bus<Pick<Narrow, 'foo'> & Pick<Other, 'other'>>();
      const properSubset = new Bus<Pick<Narrow, 'foo'>>();
      const wrongFooPayload = new Bus<{foo: string}>();

      // delegate piping already allows overlapping/disjoint targets
      src.pipe(partialOverlap);
      src.pipe(properSubset);
      src.pipe(noOverlap);
      noOverlap.pipe(partialOverlap);
      partialOverlap.pipe(properSubset);

      // ...and forward(dst) mirrors delegate piping per-message: shared events
      // must match, src-only events ('bar'/'baz') are dropped, and a disjoint
      // target is allowed (nothing lands) just like src.pipe(noOverlap).
      src.pipe((piped, forward) => {
        forward(partialOverlap); // shares 'foo'
        forward(properSubset);   // shares 'foo'
        forward(noOverlap);      // disjoint: nothing lands

        // @ts-expect-error shared 'foo' payload disagrees (number vs string)
        forward(wrongFooPayload);
      });
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

      narrow.pipe((message) => {
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
      bus.pipe((message: PipeMessage<Narrow>) => {
        if (message.event === 'foo') {
          expectType<number>(message.payload);
        } else if (message.event === 'bar') {
          expectType<string>(message.payload);
        }
      });
    });

    it('supports the documented discriminated pipe sink', () => {
      const bus = new Bus<{foo: string; bar: number}>();
      bus.pipe((message) => {
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

      bus.pipe((message) => {
        expectType<string | number>(message.payload);
        // @ts-expect-error a string-only method can't be called on string | number
        message.payload.toUpperCase();
        if (message.event === 'foo') {
          expectType<string>(message.payload);
        }
      });
    });

    it('keeps pipe sinks correlated when a wider source forwards unknown events', () => {
      const wide = new Bus<{foo: string, bar: string, baz: number}>();
      const narrow = new Bus<{foo: string, bar: string}>();

      // piping wide into narrow forwards 'baz' (number) into narrow at runtime.
      // pipe returns the delegate's own surface, so a chained sink is identical
      // to piping on `narrow` directly.
      const surface = wide.pipe(narrow);
      expectType<SubscriptionSurface<{foo: string; bar: string}>>(surface);

      // the following are the same assertions, one over the narrow bus itself, and one over the surface returned from pipe;

      narrow.pipe((message) => {
        // a forwarded 'baz' isn't part of narrow's surface, so it can't be named
        // @ts-expect-error 'baz' is not part of the delegate's surface
        if (message.event === 'baz') {
          expectType<never>(message);
        }

        if (message.event === 'foo') {
          expectType<string>(message.payload);
        } else if (message.event === 'bar') {
          expectType<string>(message.payload);
        }
      });

      surface.pipe((message) => {
        // @ts-expect-error 'baz' is not part of the delegate's surface
        if (message.event === 'baz') {
          expectType<never>(message);
        }

        if (message.event === 'foo') {
          expectType<string>(message.payload);
        } else if (message.event === 'bar') {
          expectType<string>(message.payload);
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

    it('rejects a function sink whose events are disjoint from the source map', () => {
      const bus = new Bus<Wide>();
      interface Disjoint {
        qux: number;
      }
      // @ts-expect-error a Disjoint sink shares no events with Wide
      bus.pipe((message: PipeMessage<Disjoint>) => {
        expectType<'qux'>(message.event);
      });
    });

    it('narrows payload across every event of the source map', () => {
      const bus = new Bus<Wide>();
      bus.pipe((message) => {
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

        public relayAll(sink: PipeSink<M>): Subscription {
          return this.pipe(sink);
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
        public readonly unpipe: SubscriptionSurface<{[K in TEvent]: TUpdate}>['unpipe'] = this.bus.unpipe;

        public emit(event: TEvent, update: TUpdate): boolean {
          return this.bus.emit(event, update);
        }
      }

      const instance = new Test<'change' | 'reset', {value: number}>();
      instance.on('change', payload => expectType<{value: number}>(payload));
      instance.emit('reset', {value: 2});
      instance.pipe((message) => {
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
      bus.pipe((message) => {
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

    // a generic subclass must accept wildcard sinks of every arity — nullary
    // (`pipe(() => …)`), message (`pipe((message) => …)`), and fully-typed
    // function references — over its open map.
    it('accepts nullary, message, and untyped sinks in a generic subclass', () => {
      class Test<M extends EventMap> extends Bus<M> {
        public relayAll(sink: PipeSink<M>): Subscription {
          return this.pipe(sink);
        }
      }
      const instance = new Test<Wide>();

      instance.pipe(() => undefined);
      instance.pipe((message) => {
        expectType<keyof Wide>(message.event);
        expectType<number | string | boolean>(message.payload);
      });
      const anySink: (...args: any[]) => void = () => undefined;
      instance.pipe(anySink);
      instance.relayAll(anySink);
    });

    // limitation: delegate piping (bus-into-bus) needs a concrete event map. under
    // an abstract `M` the delegate overload's payload-overlap check can't be
    // evaluated, and a `Bus<M>` is not a function, so no overload matches.
    // concrete-map delegate piping is exercised in the `variance` specs above.
    it('cannot resolve delegate piping over an abstract event map', () => {
      function bridge<M extends EventMap>(src: Bus<M>, dst: Bus<M>): void {
        // @ts-expect-error delegate piping requires a concrete map, not an abstract M
        src.pipe(dst);
      }
      expectType<typeof bridge>(bridge);

      // ...but with a concrete map the delegate overload resolves and returns the
      // delegate's own surface.
      const from = new Bus<Wide>();
      const to = new Bus<Wide>();
      const surface: SubscriptionSurface<Wide> = from.pipe(to);
      surface.on('foo', payload => expectType<number>(payload));
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
      'on' | 'pipe' | 'next' | 'scan'
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
      conn.pipe((message) => {
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
        // caveat: generic-key *forwarding* does NOT survive over a `Merge` map.
        // `Merge` is a computed mapped type, and the sound `emit` only preserves
        // the `[K, M[K]]` correlation for a naked type parameter -- so the pair
        // can't be proven here. Forward via the whole-map pattern (see
        // `WholeMap`) when you need generic-key forwarding. Literal-key emits
        // (above) are unaffected.
        public forward<K extends Exclude<Extract<keyof TIncoming, string>, keyof FixedEvents>>(
          event: K,
          payload: Merge<FixedEvents, TIncoming>[K]
        ): boolean {
          // @ts-expect-error correlation is lost indexing a computed mapped type
          return this.bus.emit(event, payload);
        }
      }

      const conn = new OuterGeneric<LeafEvents>();
      conn.announce();
    });
  });

});
