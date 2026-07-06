# Strongbus

A strongly typed, battle tested event emitter built for complex event-driven applications.

Strongbus gives you a fully type-safe event bus: events and their payloads are described by a single
`EventMap`, and every method (`on`, `once`, `emit`, `any`, `pipe`, `next`, `scan`, `hook`) is checked against it.
It also ships with subscription lifecycle hooks, bus-to-bus piping, promise-based event awaiting, and built-in
memory-leak detection.

[API Documentation](https://epferrari.github.io/strongbus)

[Migrating from v2 -> v3](./CHANGELOG.md#migrating-from-v2-to-v3)

## Features

- **Type-safe by construction** — payloads are inferred from your event map; unknown events and mismatched
  payloads are compile errors.
- **Disposable subscriptions** — every subscriber returns a `Subscription` you can release.
- **Lifecycle introspection** — hook into `active`/`idle` transitions, listener add/remove, and teardown.
- **Composable buses** — `pipe` events from one bus into another (or into a function sink).
- **Promise interop** — `await` the next event with `next`, or resolve on a computed condition with `scan`.
- **Memory-leak detection** — configurable per-event listener thresholds with info/warn/error logging.

## Installation

```bash
npm install strongbus
# or
yarn add strongbus
```

## Quick start

Describe your events as a map of `event name -> payload type`, then parameterize a `Bus` with it. Use `void`
for events that carry no payload.

```typescript
import {Bus} from 'strongbus';

interface Events {
  message: string;
  count: number;
  connected: void;
}

const bus = new Bus<Events>();

const subscription = bus.on('message', (payload) => {
  // payload is inferred as `string`
  console.log(payload.toUpperCase());
});

bus.emit('message', 'hello');   // logs "HELLO"
bus.emit('connected');          // no payload required

subscription();                 // unsubscribe
```

Type safety is enforced against the event map:

```typescript
bus.on('mesage', () => {});        // compile error: 'mesage' is not a key of Events
bus.on('count', (n: string) => {}); // compile error: 'count' carries a number
bus.emit('message');                // compile error: 'message' requires a string payload
```

## Subscriptions

Every subscriber returns a `Subscription` — a function that releases the subscription. It can be disposed by
invoking it directly or via `.unsubscribe()`; both are idempotent.

```typescript
const sub = bus.on('message', handler);

sub();              // release
sub.unsubscribe();  // equivalent; safe to call again
```

## Subscribing to events

### `on(event, handler)`

Subscribe a handler to a single event. The handler receives the event's payload.

```typescript
bus.on('count', (n) => console.log(n)); // n: number
```

### `once(event, handler)`

Like `on`, but automatically unsubscribes after the first time the event fires.

```typescript
bus.once('connected', () => console.log('connected exactly once'));
```

### `any(events, handler)`

Subscribe one handler to several events. The handler receives the raised event as its first argument and the
payload as its second.

```typescript
bus.any(['message', 'count'], (event, payload) => {
  // event: 'message' | 'count'
  // payload: string | number
});
```

### `pipe(sink)` — function sink

Pipe *every* event into a function sink. The sink receives the raised event as a single correlated
`{event, payload}` message, plus a `forward` function bound to that message. This is the wildcard
subscription; the returned `Subscription` removes it.

```typescript
const stop = bus.pipe((piped) => {
  console.log(`${String(piped.event)}:`, piped.payload);
});

stop(); // stop receiving all events
```

Keeping the pair as one value means narrowing `piped.event` correlatively narrows `piped.payload`. To send the
event on to another bus, call `forward(dst)` rather than splitting the pair back into `(event, payload)` — this
re-emits the whole message on `dst` without registering a delegate (so none of the listener-lifecycle overhead
a delegate pipe incurs):

```typescript
bus.pipe((piped, forward) => {
  if (piped.event === 'didRemoveItem') {
    cache.delete(piped.payload.id); // payload narrowed to this event's type
  }
  forward(other); // re-emit the whole message on a payload-compatible bus
});
```

`forward`'s target is constrained exactly like a delegate `pipe(dst)`: every event `dst` declares must either
be absent from the source or carry the same payload type. It's therefore impossible to land an event on `dst`
with a payload type `dst` doesn't expect, and source-only events `dst` doesn't declare are simply dropped.
Because the sink never hands you a bare `(event, payload)` pair to re-`emit`, a mismatched pair can't be
fabricated — `emit` itself only accepts a correlated `(event, payload)`, never a `{event, payload}` object.

## Emitting events

`emit(event, payload)` returns a `boolean` indicating whether the event was handled (by an own listener, a
wildcard sink, or a delegate bus).

```typescript
const handled = bus.emit('message', 'hello');
```

Events mapped to a `void` payload can be emitted with no second argument (or `null`/`undefined`):

```typescript
bus.emit('connected');
bus.emit('connected', null);
```

By default, emitting an event with no listeners is a no-op. Set `allowUnhandledEvents: false` to instead route
unhandled events through `handleUnexpectedEvent` (which throws by default; override it in a subclass to
customize).

## Piping buses together

`pipe` also accepts another `Bus`, forwarding this bus's events into the target and counting the target's
listeners as handlers. It returns the target bus, so pipes can be chained. Use `unpipe` to detach.

```typescript
const root = new Bus<Events>();
const feature = new Bus<Events>();

root.pipe(feature);          // events emitted on `root` are observed by `feature`'s listeners
feature.on('message', handle);

root.emit('message', 'hi');  // `handle` is invoked

root.unpipe(feature);        // detach
```

### `pipe(bus)` vs. a forwarding sink

There are two ways to aggregate events across buses, and they trade off differently.

**`root.pipe(leaf)` — delegate piping.** Reach for this when you need `root` to know *when listeners for
specific events are added or removed* through `leaf` — its `willAddListener` / `didAddListener` /
`willRemoveListener` / `didRemoveListener` hooks fire for the delegate's listeners — or when you have a *linear
chain* of buses. The delegate's listeners count toward `root`'s listener count, and pipes chain
(`root.pipe(b).pipe(c)`).

```typescript
const root = new Bus<Events>();

let producing = false;
const produce = () => {
  if (producing) {
    root.emit('foo', payload);
  }
};

// `root` reacts to demand for 'foo' anywhere downstream
root.hook('didAddListener', (event) => { if (event === 'foo') producing = true; });
root.hook('didRemoveListener', (event) => { if (event === 'foo') producing = false; });

const b = new Bus<Events>();
b.on('foo', handleFoo);
const c = new Bus<Events>();
c.on('foo', handleFoo);

produce();        // producing === false, nothing emitted

root.pipe(b);     // events flow root -> b; 'foo' now has a downstream listener
produce();        // handleFoo called once

b.pipe(c);        // events flow root -> b -> c
produce();        // handleFoo called on both b and c

b.unpipe(c);
root.unpipe(b);   // 'foo' has no downstream listeners again; `producing` flips back to false
```

**`leaf.pipe((msg, forward) => forward(root))` — forwarding sink.** Reach for this when you *don't* care about
listener add/remove bookkeeping, or when you have an *inverted tree* of many buses funneling into a single
`root` and you attach your listeners on `root`. A forwarding sink registers no delegate, so it skips the
lifecycle-hook and listener-count overhead that `pipe(bus)` incurs.

```typescript
const root = new Bus<Events>();
root.on('foo', handleFoo);

const b = new Bus<Events>();
const c = new Bus<Events>();

b.pipe((msg, forward) => forward(root)); // events flow b -> root
c.pipe((msg, forward) => forward(root)); // events flow c -> root

b.emit('foo', payload);  // handleFoo called
c.emit('foo', payload);  // handleFoo called
```

See [Migrating from v2: `pipe(bus)` vs. forwarding sink](./CHANGELOG.md#pipebus-vs-forwarding-sink).

## Awaiting events

### `next(resolutionTrigger, rejectionTrigger?)`

Returns a `CancelablePromise` that resolves with `{event, payload}` when the resolution trigger fires. Optionally
provide a disjoint rejection trigger. Triggers are a single event key or an array of events (`SubscribableListenable`);
`'*'` is not accepted.

```typescript
const {event, payload} = await bus.next('message');
// event: 'message', payload: string

const result = await bus.next(['message', 'connected', 'count']);

// resolve on either event; reject if `count` fires first
const result = await bus.next(['message', 'connected'], 'count');

// resolution and rejection triggers must be disjoint (compile error otherwise)
bus.next('message', 'message'); // compile error
```

### `scan(trigger, evaluator, options?)`

Resolve or reject a promise based on an evaluation run whenever a trigger fires. The evaluator is handed a
`resolve`/`reject` pair and decides whether the current state settles the promise. Triggers are
`Listenable` — a single event, an array of events, or the wildcard (`'*'`). When reading `resolve.trigger.payload`, narrow on
`event` first.

```typescript
const ready = await bus.scan<boolean>(
  ['message', 'connected'],
  (resolve) => {
    if (resolve.trigger.type === 'event' && resolve.trigger.event === 'connected') {
      resolve(true);
    }
  }
);
```

`scan` options (see the
[`scan` API docs](https://epferrari.github.io/strongbus/classes/Bus.html#scan) for canonical defaults):

- `eager` — run the evaluator immediately, so an already-satisfied condition resolves without waiting for an
  event. This avoids the `if (!condition) { await scan(...) }` anti-pattern.
- `pool` — reuse an in-flight scan that shares the same evaluator, eagerness, and a superset trigger, instead of
  subscribing redundantly.
- `timeout` — cancel the scan after N milliseconds. Configuring a timeout disables pooling.

The `<T>` type argument is the resolved value's type and flows into the resolver:

```typescript
bus.scan<number>('count', (resolve) => resolve('nope')); // compile error: expected number
```

The object form `scan({evaluator, trigger, ...options})` is deprecated but still supported.

## Lifecycle hooks

`hook(lifecycleEvent, handler)` subscribes to meta events about the bus itself:

| Event | Fired when |
| --- | --- |
| `willActivate` / `active` | the bus goes from 0 to 1 listeners |
| `willIdle` / `idle` | the bus goes from 1 to 0 listeners |
| `willAddListener` / `didAddListener` | a listener is added (payload: the event) |
| `willRemoveListener` / `didRemoveListener` | a listener is removed (payload: the event) |
| `willDestroy` | `destroy()` is called |
| `error` | a listener or hook throws / rejects (payload: `{error, event}`) |

```typescript
bus.hook('error', ({error, event}) => {
  console.error(`handler for "${String(event)}" failed`, error);
});
```

### `monitor(handler)`

Shorthand for observing the active/idle transition. The handler receives `true` when the bus becomes active and
`false` when it becomes idle.

```typescript
bus.monitor((isActive) => console.log(isActive ? 'active' : 'idle'));
```

## Surfaces

`Bus` implements four typed surfaces over the same event map. Compose them when a dependency needs only part of the API.

| Surface | Methods | Use when |
|---------|---------|----------|
| **`ControlSurface`** | `emit`, `destroy` | Raising events or tearing down a bus |
| **`SubscriptionSurface`** | `on`, `once`, `any`, `next`, `scan`, `pipe`, `unpipe` | Subscribing, awaiting, or forwarding events |
| **`IntrospectionSurface`** | `hasListeners`, `getListeners`, `getListenerCount`, `hasListenersFor`, `getEventCount`, `getListenerCountFor`, `getListenersFor`, `forEach` | Inspecting listener state |
| **`MonitoringSurface`** | `monitor`, `hook`, `active` | Observing lifecycle and active/idle state |

A `Bus<Wide>` is assignable to any narrower view (for example `SubscriptionSurface<Narrow>`) so consumers can declare only the events and capabilities they need.

### SubscriptionSurface

Type a dependency as `SubscriptionSurface<Events>` when it may listen, await, pipe, or scan but must not raise events.

```typescript
import {Bus, type SubscriptionSurface} from 'strongbus';

interface AppEvents {
  message: string;
  count: number;
}

interface FeatureEvents {
  message: string;
}

function wireFeature(source: SubscriptionSurface<FeatureEvents>) {
  source.on('message', handle);   // ok
  source.on('count', handle);     // compile error: 'count' is not in FeatureEvents
}

const app = new Bus<AppEvents>();
wireFeature(app);                 // Bus<AppEvents> is a SubscriptionSurface<FeatureEvents>
```

Because event-map typing is contravariant on the subscription surface, a bus that emits a wider map can be passed where only a subset of events is relevant. Methods such as `scan`, `any`, `next`, and `pipe` respect the declared map — listening to unknown events are compile errors on the narrowed view.

## Composing event maps

Event maps are plain types, so you can compose them. An intersection (`A & B`) works for concrete maps, but breaks down when one side is an open generic type parameter: indexing `(Fixed & TGeneric)[K]` produces a *deferred* type (e.g. `string & TGeneric[K]`), so a generic base class can't `emit` a fixed event with a plain literal payload without casting.

`Merge<Base, Ext>` is a flattening merge that avoids this — overlapping keys take `Base`, and every key resolves to a single payload rather than an intersection:

```typescript
import {Bus, type Merge} from 'strongbus';

interface BaseEvents {
  healthChanged: string;
  ready: void;
}

// merge the fixed map as `Base` and the open generic as the sole `Ext`
abstract class Connection<TIncoming extends object> {
  protected readonly bus = new Bus<Merge<BaseEvents, TIncoming>>();

  public reportHealth(status: string): void {
    this.bus.emit('healthChanged', status); // literal payload, no cast
    this.bus.emit('ready', null);           // void event; see note below
  }
}
```

Position matters: a fixed key emits cleanly only when it resolves in a layer whose *keyset* is concrete, before any layer that folds in the open generic's keyset. When you have several fixed maps, flatten them together first and merge the open generic last — prefer `Merge<Merge<BaseEvents, MoreFixed>, TGeneric>` over nesting the generic in an inner layer such as `Merge<BaseEvents, Merge<MoreFixed, TGeneric>>`.

> **Note:** whenever the event map is still an open generic (whether merged or a bare type parameter like `Bus<T>`), emit `void` events with an explicit `null` (`emit('ready', null)`) rather than the no-argument form (`emit('ready')`). The no-argument overload gates on `VoidEventKeys`, which filters the whole keyset and can't confirm a key is `void` while any part of that keyset is an unresolved generic. The explicit-`null` form rides the correlated overload (gated on `keyof` membership) and always resolves.

### Forwarding a generic event key

`emit` proves that `(event, payload)` is a *correlated* pair — you can't pass a union-typed `event` with a union-typed `payload` without first discriminating on `event` (so an un-narrowed pipe sink can't forward a mismatched pair). Forwarding a single *generic* key `emit(event, payload)` still works, but only when the bus map is a **naked type parameter**. TypeScript preserves the `[K, M[K]]` correlation for `Bus<M>`, but drops it when indexing a computed mapped type like `Merge<Fixed, TIncoming>`. So make the whole map the type parameter when you need to forward:

```typescript
abstract class Relay<M extends BaseEvents> {
  protected readonly bus = new Bus<M>();

  // `[K, M[K]]` stays correlated over a naked `M`, so this type-checks
  public forward<K extends keyof M>(event: K, payload: M[K]): boolean {
    return this.bus.emit(event, payload);
  }
}
```

If you must key the bus off a `Merge`, forward inside a discriminated branch (a `switch`/`if` on `event`) so each arm emits a literal key instead.

## Introspection

The introspection methods take an optional `{scope?: ListenerScope}` options
argument. `ListenerScope` selects which handlers to include and defaults to
`ListenerScope.ANY`:

- `OWN` — registered directly on this bus (including function sinks from `pipe(handler)`)
- `DELEGATE` — on buses attached with `pipe(bus)` only
- `ANY` — `OWN | DELEGATE` (equivalent alias, the default)

```typescript
import {Bus, ListenerScope} from 'strongbus';

bus.active;                                                          // boolean: does the bus have any subscribers
bus.hasListeners(/* options? */);                                    // any scope (default)
bus.getListenerCount(/* options? */);                                // total handlers in scope
bus.getListeners(/* options? */);                                    // union of all handlers in scope
bus.getEventCount(/* options? */);                                   // events with at least one listener in scope

bus.hasListenersFor('message', {scope: ListenerScope.OWN});
bus.getListenerCountFor('message', {scope: ListenerScope.DELEGATE});
bus.getListenersFor('message', /* options? */);                        // empty set when none
bus.forEach((event, handlers) => { /* ... */ }, /* options? */);
```

## Teardown

`destroy()` releases all event subscribers, fires `willDestroy`, removes all hooks, and detaches all delegates.

```typescript
bus.destroy();
```

## Options

`new Bus<Events>(options)` accepts:

- `name` — included in logs and unhandled-event errors.
- `allowUnhandledEvents` — when `false`, unhandled events route to `handleUnexpectedEvent` instead of being a
  no-op.
- `thresholds` — per-event listener-count thresholds (`info`/`warn`/`error`) for memory-leak logging.
- `logger` — a `Logger`, or a `() => Logger` provider.
- `verbose` — log on every listener past a threshold, or only at threshold boundaries.

```typescript
const bus = new Bus<Events>({
  name: 'MyBus',
  allowUnhandledEvents: false,
  thresholds: {warn: 50},
  logger: console
});
```

See the [`Options`](https://epferrari.github.io/strongbus/interfaces/Options.html) and
[`ListenerThresholds`](https://epferrari.github.io/strongbus/interfaces/ListenerThresholds.html) API docs for the
canonical defaults and types.

Defaults can be set globally for all instances via static setters:

```typescript
Bus.defaultAllowUnhandledEvents = false;
Bus.defaultThresholds = {warn: 50};
Bus.defaultLogger = myLogger;
Bus.verbose = false;
```

## Memory-leak detection

When the number of listeners for a single event crosses a configured threshold, Strongbus logs a message at the
corresponding severity (`info`/`warn`/`error`). This surfaces leaks from subscriptions that are never released.
With `verbose: false`, messages are throttled to threshold boundaries and multiples rather than every listener.

## License

MIT
