# Strongbus

A strongly typed, battle tested event emitter built for complex event-driven applications.

Strongbus gives you a fully type-safe event bus: events and their payloads are described by a single
`EventMap`, and every method (`on`, `once`, `emit`, `any`, `pipe`, `next`, `scan`, `hook`) is checked against it.
It also ships with subscription lifecycle hooks, bus-to-bus piping, promise-based event awaiting, and built-in
memory-leak detection.

[API Documentation](https://epferrari.github.io/strongbus)

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

Pipe *every* event into a function sink. The sink receives the raised event and its payload. This is the
wildcard subscription; the returned `Subscription` removes it.

```typescript
const stop = bus.pipe((event, payload) => {
  console.log(`${String(event)}:`, payload);
});

stop(); // stop receiving all events
```

## Emitting events

`emit(event, ...payload)` returns a `boolean` indicating whether the event was handled (by an own listener, a
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

## Awaiting events

### `next(resolutionTrigger, rejectionTrigger?)`

Returns a `CancelablePromise` that resolves with `{event, payload}` when the resolution trigger fires. Optionally
provide a disjoint rejection trigger. The trigger may be a single event, an array of events, or the `'*'`
wildcard.

```typescript
const {event, payload} = await bus.next('message');
// event: 'message', payload: string

// resolve on either event; reject if `count` fires first
const result = await bus.next(['message', 'connected'], 'count');

// resolution and rejection triggers must be disjoint (compile error otherwise)
bus.next('message', 'message'); // compile error
```

### `scan(params)`

Resolve or reject a promise based on an evaluation run whenever a trigger fires. The evaluator is handed a
`resolve`/`reject` pair and decides whether the current state settles the promise.

```typescript
const ready = await bus.scan<boolean>({
  evaluator: (resolve) => {
    if (isReady()) {
      resolve(true);
    }
  },
  trigger: ['message', 'connected']
});
```

`scan` options (only `trigger` is required; see the
[`scan` API docs](https://epferrari.github.io/strongbus/classes/Bus.html#scan) for canonical defaults):

- `trigger` — the event, array of events, or `'*'` that re-runs the evaluator.
- `eager` — run the evaluator immediately, so an already-satisfied condition resolves without waiting for an
  event. This avoids the `if (!condition) { await scan(...) }` anti-pattern.
- `pool` — reuse an in-flight scan that shares the same evaluator, eagerness, and a superset trigger, instead of
  subscribing redundantly.
- `timeout` — cancel the scan after N milliseconds. Configuring a timeout disables pooling.

The `<T>` type argument is the resolved value's type and flows into the resolver:

```typescript
bus.scan<number>({
  evaluator: (resolve) => resolve('nope'), // compile error: expected number
  trigger: 'count'
});
```

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

## Introspection

```typescript
bus.active;                         // boolean: does the bus have any subscribers
bus.hasListeners;                   // own or delegate listeners
bus.hasOwnListeners;                // listeners registered directly on this bus
bus.hasDelegateListeners;           // listeners contributed by piped buses
bus.listenerCount;                  // total
bus.hasListenersFor('message');
bus.getListenerCountFor('message');
bus.listeners;                      // ReadonlyMap<event, ReadonlySet<handler>>
bus.ownListeners;
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
