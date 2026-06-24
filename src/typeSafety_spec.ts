import {Bus} from './strongbus';
import {Scanner} from './scanner';
import {WILDCARD} from './types/events';

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
      // an array trigger resolves with a discriminated {event, payload} union
      bus.next(['foo', 'bar']).then(result => {
        expectType<'foo' | 'bar'>(result.event);
        if(result.event === 'foo') {
          expectType<number>(result.payload);
        } else {
          expectType<string>(result.payload);
        }
      });
      // a wildcard trigger resolves with a pair over every event in the map
      bus.next('*').then(result => {
        expectType<keyof TestEventMap>(result.event);
      });
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
    });
  });

  describe('#scan', () => {
    const evaluator: Scanner.Evaluator<boolean, TestEventMap> = resolve => {
      resolve(true);
    };

    typeChecks.push(function validTrigger(): void {
      const bus = new Bus<TestEventMap>();
      bus.scan({evaluator, trigger: 'foo'});
      bus.scan({evaluator, trigger: ['foo', 'bar']});
      bus.scan({evaluator, trigger: '*'});
    });

    typeChecks.push(function rejectsUnknownTrigger(): void {
      const bus = new Bus<TestEventMap>();
      // @ts-expect-error 'qux' is not a key of TestEventMap
      bus.scan({evaluator, trigger: 'qux'});
    });

    typeChecks.push(function resultTypeDrivesEvaluatorAndPromise(): void {
      const bus = new Bus<TestEventMap>();
      // the type argument is the resolved result type, and flows into the resolver
      const result = bus.scan<number>({
        evaluator: resolve => {
          resolve(1);
          resolve.resolve(2);
        },
        trigger: 'foo'
      });
      result.then(value => expectType<number>(value));
    });

    typeChecks.push(function inferredResultTypeFromTypedEvaluator(): void {
      const bus = new Bus<TestEventMap>();
      // result type is inferred from a pre-typed evaluator
      bus.scan({evaluator, trigger: 'foo'}).then(value => expectType<boolean>(value));
    });

    typeChecks.push(function rejectsMismatchedResolveValue(): void {
      const bus = new Bus<TestEventMap>();
      bus.scan<number>({
        evaluator: resolve => {
          // @ts-expect-error result type is number, not string
          resolve('nope');
        },
        trigger: 'foo'
      });
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

    // a view of the publicly-consumed subscription surface
    interface BusView<T extends object> extends Pick<Bus<T>, 'on'|'once'|'any'|'pipe'|'scan'|'next'> {}

    // a subclass of Bus over the wider map
    class WideBus extends Bus<Wide> {}

    // the contravariant payoff: a Bus over a wider map satisfies a view over a
    // narrower one, so a subclass can declare it `implements` the narrow view.
    // a broken variance would make this class declaration fail to compile.
    class NarrowableBus extends WideBus implements BusView<Narrow> {}

    typeChecks.push(function wideBusSatisfiesNarrowView(): void {
      const evaluator: Scanner.Evaluator<boolean, Narrow> = resolve => {
        resolve(true);
      };

      // a Bus over a wider event map is assignable to a view over a narrower one
      const view: BusView<Narrow> = new Bus<Wide>();
      view.on('foo', payload => expectType<number>(payload));
      view.once('bar', payload => expectType<string>(payload));
      view.any(['foo', 'bar'], (event, payload) => {
        expectType<keyof Narrow>(event);
        expectType<Narrow[keyof Narrow]>(payload);
      });
      view.scan({evaluator, trigger: 'foo'});
      view.next('foo').then(result => {
        expectType<'foo'>(result.event);
        expectType<number>(result.payload);
      });

      // ...and so is a subclass instance
      const subclassView: BusView<Narrow> = new WideBus();
      subclassView.on('bar', payload => expectType<string>(payload));

      const narrowable = new NarrowableBus();
      expectType<BusView<Narrow>>(narrowable);
      // the concrete type still exposes its full (wide) event map
      narrowable.on('baz', payload => expectType<boolean>(payload));
      narrowable.scan({
        evaluator: resolve => resolve(true),
        trigger: 'baz'
      });
    });

    typeChecks.push(function narrowViewRejectsUnknownEvent(): void {
      const view: BusView<Narrow> = new Bus<Wide>();
      const evaluator: Scanner.Evaluator<boolean, Narrow> = resolve => {
        resolve(true);
      };

      // @ts-expect-error 'baz' is not in the Narrow view, even though the underlying bus is Wide
      view.on('baz', () => undefined);
      // @ts-expect-error 'baz' is not in the Narrow view, even though the underlying bus is Wide
      view.once('baz', () => undefined);
      // @ts-expect-error 'baz' is not in the Narrow view, even though the underlying bus is Wide
      view.any(['baz'], () => undefined);
      // @ts-expect-error 'baz' is not in the Narrow view, even though the underlying bus is Wide
      view.scan({evaluator, trigger: 'baz'});
      // @ts-expect-error 'baz' is not in the Narrow view, even though the underlying bus is Wide
      view.next('baz');
    });

    typeChecks.push(function pipeAcceptsCompatibleSink(): void {
      const bus = new Bus<Wide>();
      bus.pipe(<T extends keyof Narrow>(event: T, payload: Narrow[T]) => {
        expectType<keyof Wide>(event);
        expectType<Wide[keyof Wide]>(payload);
      });
    });
  });

  it('enforces event and payload types at compile time', () => {
    expect(typeChecks.length).toBeGreaterThan(0);
    expect(typeChecks.every(check => typeof check === 'function')).toBe(true);
  });
});
