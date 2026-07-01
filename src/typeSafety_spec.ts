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
 * directive as unused (TS2578) and fail the build. The runtime `it` block
 * exists so jasmine has something to execute.
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

  // referenced (but never invoked) so the type-checks run without side effects
  const typeChecks: (() => void)[] = [];

  describe('#on', () => {
    typeChecks.push(function validEventAndPayload(): void {
      const bus = new Bus<TestEventMap>();
      bus.on('foo', payload => expectType<number>(payload));
      bus.on('baz', payload => expectType<void>(payload));
    });

    typeChecks.push(function rejectsUnknownEvent(): void {
      const bus = new Bus<TestEventMap>();
      // @ts-expect-error 'qux' is not a key of TestEventMap
      bus.on('qux', () => undefined);
    });

    typeChecks.push(function rejectsMismatchedPayload(): void {
      const bus = new Bus<TestEventMap>();
      // @ts-expect-error 'foo' carries a number payload, not a string
      bus.on('foo', (payload: string) => undefined);
    });

    typeChecks.push(function rejectsWildcard(): void {
      const bus = new Bus<WildcardEventMap>();
      // @ts-expect-error WILDCARD is reserved for internal use
      bus.on(WILDCARD, () => undefined);
      // @ts-expect-error WILDCARD is reserved for internal use
      bus.on('*', () => undefined);
    });
  });

  describe('#once', () => {
    typeChecks.push(function validEventAndPayload(): void {
      const bus = new Bus<TestEventMap>();
      bus.once('bar', payload => expectType<string>(payload));
    });

    typeChecks.push(function rejectsUnknownEvent(): void {
      const bus = new Bus<TestEventMap>();
      // @ts-expect-error 'qux' is not a key of TestEventMap
      bus.once('qux', () => undefined);
    });

    typeChecks.push(function rejectsMismatchedPayload(): void {
      const bus = new Bus<TestEventMap>();
      // @ts-expect-error 'bar' carries a string payload, not a number
      bus.once('bar', (payload: number) => undefined);
    });

    typeChecks.push(function rejectsWildcard(): void {
      const bus = new Bus<WildcardEventMap>();
      // @ts-expect-error WILDCARD is reserved for internal use
      bus.once(WILDCARD, () => undefined);
      // @ts-expect-error WILDCARD is reserved for internal use
      bus.once('*', () => undefined);
    });
  });

  describe('#any', () => {
    typeChecks.push(function validEventSubset(): void {
      const bus = new Bus<TestEventMap>();
      bus.any(['foo', 'bar'], (event, payload) => {
        expectType<keyof TestEventMap>(event);
        expectType<TestEventMap[keyof TestEventMap]>(payload);
      });
    });

    typeChecks.push(function rejectsUnknownEvent(): void {
      const bus = new Bus<TestEventMap>();
      // @ts-expect-error 'qux' is not a key of TestEventMap
      bus.any(['foo', 'qux'], () => undefined);
    });

    typeChecks.push(function rejectsWildcard(): void {
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
    typeChecks.push(function validTriggers(): void {
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

    typeChecks.push(function rejectsWildcardResolutionTrigger(): void {
      const bus = new Bus<TestEventMap>();
      // @ts-expect-error wildcard is not allowed as a resolution trigger
      bus.next('*');
    });

    typeChecks.push(function rejectsWildcardRejectionTrigger(): void {
      const bus = new Bus<TestEventMap>();
      // @ts-expect-error wildcard is not allowed as a rejection trigger
      bus.next('foo', '*');
    });

    typeChecks.push(function rejectsUnknownResolutionTrigger(): void {
      const bus = new Bus<TestEventMap>();
      // @ts-expect-error 'qux' is not a key of TestEventMap
      bus.next('qux');
    });

    typeChecks.push(function rejectsUnknownRejectionTrigger(): void {
      const bus = new Bus<TestEventMap>();
      // @ts-expect-error 'qux' is not a key of TestEventMap
      bus.next('foo', 'qux');
    });

    typeChecks.push(function rejectsOverlappingTriggers(): void {
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

    typeChecks.push(function validTrigger(): void {
      const bus = new Bus<TestEventMap>();
      bus.scan('foo', evaluator);
      bus.scan(['foo', 'bar'], evaluator);
      bus.scan('*', evaluator);
      bus.scan({evaluator, trigger: 'foo'});
      bus.scan({evaluator, trigger: ['foo', 'bar']});
      bus.scan({evaluator, trigger: '*'});
    });

    typeChecks.push(function rejectsUnknownTrigger(): void {
      const bus = new Bus<TestEventMap>();
      // @ts-expect-error 'qux' is not a key of TestEventMap
      bus.scan('qux', evaluator);
      // @ts-expect-error 'qux' is not a key of TestEventMap
      bus.scan({evaluator, trigger: 'qux'});
    });

    typeChecks.push(function resultTypeDrivesEvaluatorAndPromise(): void {
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

    typeChecks.push(function inferredResultTypeFromTypedEvaluator(): void {
      const bus = new Bus<TestEventMap>();
      bus.scan('foo', evaluator).then(value => expectType<boolean>(value));
      bus.scan({evaluator, trigger: 'foo'}).then(value => expectType<boolean>(value));
    });

    typeChecks.push(function rejectsMismatchedResolveValue(): void {
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

    typeChecks.push(function scanEvaluatorDiscriminatesTrigger(): void {
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

    typeChecks.push(function scanEvaluatorRejectsUniformTriggerPayload(): void {
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

    typeChecks.push(function wideBusSatisfiesNarrowMonitoringSurfaceHook(): void {
      const wide = new Bus<Wide>();
      const monitor: MonitoringSurface<Narrow> = wide;

      monitor.hook('didAddListener', event => {
        expectType<LifecycleSubjectEvent<Narrow>>(event);
        expectType<keyof Narrow | typeof WILDCARD | string>(event);
      });
    });

    typeChecks.push(function listenerLifecycleHookAcceptsUndeclaredEventKeys(): void {
      const narrow: MonitoringSurface<Narrow> = new Bus<Wide>();

      narrow.hook(Lifecycle.didAddListener, event => {
        expectType<LifecycleSubjectEvent<Narrow>>(event);
        expectType<keyof Narrow | typeof WILDCARD | string>(event);
      });
      narrow.hook('willRemoveListener', event => {
        expectType<LifecycleSubjectEvent<Narrow>>(event);
      });
    });

    typeChecks.push(function listenerLifecycleHookRejectsNarrowOnlyHandler(): void {
      const narrow: MonitoringSurface<Narrow> = new Bus<Wide>();

      // @ts-expect-error hook handlers must accept undeclared event keys on a narrowed view
      narrow.hook('didAddListener', (event: keyof Narrow) => undefined);
    });

    typeChecks.push(function errorHookAcceptsUndeclaredEventKeys(): void {
      const narrow: MonitoringSurface<Narrow> = new Bus<Wide>();

      narrow.hook('error', ({error, event}) => {
        expectType<Error>(error);
        expectType<LifecycleSubjectEvent<Narrow> | Lifecycle>(event);
      });
    });

    typeChecks.push(function errorHookRejectsNarrowOnlyEventField(): void {
      const narrow: MonitoringSurface<Narrow> = new Bus<Wide>();

      // @ts-expect-error error hook must accept undeclared event keys on a narrowed view
      narrow.hook('error', ({event}: {error: Error, event: keyof Narrow}) => undefined);
    });

    typeChecks.push(function voidLifecycleHooksUnchanged(): void {
      const bus = new Bus<TestEventMap>();

      bus.hook('active', () => undefined);
      bus.hook('willDestroy', () => undefined);
      bus.hook(Lifecycle.willActivate, () => undefined);
    });
  });

  describe('listener introspection', () => {
    typeChecks.push(function validEventKeysAndReturnTypes(): void {
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

    typeChecks.push(function rejectsUnknownEventOnGetListenersFor(): void {
      const bus = new Bus<TestEventMap>();
      // @ts-expect-error 'qux' is not a key of TestEventMap
      bus.getListenersFor('qux', {scope: ListenerScope.ANY});
    });

    typeChecks.push(function rejectsUnknownEventOnGetListenerCountFor(): void {
      const bus = new Bus<TestEventMap>();
      // @ts-expect-error 'qux' is not a key of TestEventMap
      bus.getListenerCountFor('qux', {scope: ListenerScope.OWN});
    });

    typeChecks.push(function rejectsUnknownEventOnHasListenersFor(): void {
      const bus = new Bus<TestEventMap>();
      // @ts-expect-error 'qux' is not a key of TestEventMap
      bus.hasListenersFor('qux', {scope: ListenerScope.DELEGATE});
    });

    typeChecks.push(function introspectionSurfaceViewAcceptsKnownEvents(): void {
      const surface: IntrospectionSurface<TestEventMap> = new Bus<TestEventMap>();

      surface.getListenersFor('foo');
      surface.getListenerCountFor('bar', {scope: ListenerScope.OWN});
      surface.hasListenersFor('baz', {scope: ListenerScope.DELEGATE});
      surface.forEach((event, handlers) => {
        expectType<EventKeys<TestEventMap> | typeof WILDCARD>(event);
        expectType<ListenerSet>(handlers);
      });
    });

    typeChecks.push(function subscriptionSurfaceViewAcceptsKnownEvents(): void {
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

    typeChecks.push(function wideBusSatisfiesNarrowSubscriptionSurface(): void {
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

    typeChecks.push(function wideBusSatisfiesNarrowIntrospectionSurface(): void {
      const wide = new Bus<Wide>();
      const narrowed: IntrospectionSurface<Narrow> = wide;

      expectType<number>(narrowed.getListenerCountFor('foo', {scope: ListenerScope.ANY}));
      expectType<ListenerSet>(narrowed.getListenersFor('bar', {scope: ListenerScope.OWN}));
    });

    typeChecks.push(function wideBusCompositionSatisfiesNarrowSurfaces(): void {
      // a wrapper that implements the narrow surfaces via composition
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

      const evaluator: Scanner.Evaluator<boolean, Narrow> = resolve => {
        resolve(true);
      };

      const narrow = new NarrowSurface();
      expectType<SubscriptionSurface<Narrow>>(narrow);
      expectType<IntrospectionSurface<Narrow>>(narrow);
      expectType<MonitoringSurface<Narrow>>(narrow);
      expectType<ControlSurface<Narrow>>(narrow);
      narrow.on('foo', payload => expectType<number>(payload));
      narrow.once('bar', payload => expectType<string>(payload));
      narrow.any(['foo', 'bar'], (event, payload) => {
        expectType<keyof Narrow>(event);
        expectType<Narrow[keyof Narrow]>(payload);
      });
      narrow.scan({evaluator, trigger: 'foo'});
      narrow.next('foo').then(result => {
        expectType<'foo'>(result.event);
        expectType<number>(result.payload);
      });
      expectType<number>(narrow.getListenerCountFor('foo', {scope: ListenerScope.ANY}));
      expectType<ListenerSet>(narrow.getListenersFor('bar', {scope: ListenerScope.OWN}));
    });

    typeChecks.push(function narrowSubscriptionSurfaceRejectsUnknownEvent(): void {
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

    typeChecks.push(function narrowIntrospectionSurfaceRejectsUnknownEvent(): void {
      const narrow: IntrospectionSurface<Narrow> = new Bus<Wide>();

      // @ts-expect-error 'baz' is not in the Narrow view, even though the underlying bus is Wide
      narrow.getListenersFor('baz', {scope: ListenerScope.ANY});
      // @ts-expect-error 'baz' is not in the Narrow view, even though the underlying bus is Wide
      narrow.getListenerCountFor('baz', {scope: ListenerScope.ANY});
    });

    typeChecks.push(function narrowPipeAcceptsWideBus(): void {
      const narrow: SubscriptionSurface<Narrow> = new Bus<Wide>();
      const wideBus = new Bus<Wide>();

      const delegate = narrow.pipe(wideBus);
      expectType<SubscriptionSurface<Wide>>(delegate);
      delegate.on('foo', payload => expectType<number>(payload));
      delegate.on('baz', payload => expectType<boolean>(payload));
    });

    typeChecks.push(function narrowPipeAcceptsWideSink(): void {
      const narrow: SubscriptionSurface<Narrow> = new Bus<Wide>();

      narrow.pipe((event, payload) => {
        expectType<keyof Narrow | string>(event);
        if (event === 'foo') {
          expectType<number>(payload as number);
        } else if (event === 'bar') {
          expectType<string>(payload as string);
        } else {
          expectType<unknown>(payload);
        }
      });
    });

    typeChecks.push(function narrowPipeRejectsUniformWideSink(): void {
      const narrow: SubscriptionSurface<Narrow> = new Bus<Wide>();
      const wideSink: EventSink<Wide> = (event, payload) => {
        expectType<keyof Wide>(event);
        expectType<Wide[keyof Wide]>(payload);
      };

      // @ts-expect-error pipe sinks must discriminate events or accept unknown payloads for undeclared events
      narrow.pipe(wideSink);
    });

    typeChecks.push(function narrowPipeRejectsIncompatibleDelegate(): void {
      const narrow: SubscriptionSurface<Narrow> = new Bus<Wide>();

      interface Incompatible {
        foo: string;
        bar: string;
      }

      // @ts-expect-error delegate emit must accept Narrow payloads for shared events
      narrow.pipe(new Bus<Incompatible>());
    });

    typeChecks.push(function narrowPipeRejectsIncompatibleSink(): void {
      const narrow: SubscriptionSurface<Narrow> = new Bus<Wide>();

      interface WrongEvents {
        qux: number;
      }

      const wrongSink: EventSink<WrongEvents> = () => undefined;

      // @ts-expect-error sink must accept Narrow event keys and payloads
      narrow.pipe(wrongSink);
    });

    typeChecks.push(function widePipeRejectsNarrowSinkWithoutUnknown(): void {
      const bus = new Bus<Wide>();
      // @ts-expect-error sink must discriminate events or accept unknown payloads for undeclared events
      bus.pipe(<T extends keyof Narrow>(event: T, payload: Narrow[T]) => {
        expectType<keyof Wide>(event);
        expectType<Wide[keyof Wide]>(payload);
      });
    });

    typeChecks.push(function widePipeAcceptsNarrowSinkWithUnknown(): void {
      const bus = new Bus<Wide>();
      bus.pipe(<K extends keyof Wide | string>(event: K, payload: K extends keyof Wide ? Wide[K] : unknown) => {
        expectType<keyof Wide | string>(event);
        switch (event) {
          case 'foo':
            expectType<number>(payload as number);
            break;
          case 'bar':
            expectType<string>(payload as string);
            break;
          case 'baz':
            expectType<boolean>(payload as boolean);
            break;
          default:
            expectType<unknown>(payload);
        }
      });
    });

    typeChecks.push(function widePipeAcceptsNarrowBus(): void {
      const wide = new Bus<Wide>();
      const narrowBus = new Bus<Narrow>();

      const delegate = wide.pipe(narrowBus);
      expectType<SubscriptionSurface<Narrow>>(delegate);
      delegate.on('foo', payload => expectType<number>(payload));
      delegate.on('bar', payload => expectType<string>(payload));
      // @ts-expect-error 'baz' is not in the Narrow delegate's event map
      delegate.on('baz', () => undefined);
    });
  });

  it('enforces event and payload types at compile time', () => {
    expect(typeChecks.length).toBeGreaterThan(0);
    expect(typeChecks.every(check => typeof check === 'function')).toBe(true);
  });
});
