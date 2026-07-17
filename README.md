# Strongbus

A strongly typed, battle tested event emitter built for complex event-driven applications.

Strongbus gives you a fully type-safe event bus: events and their payloads are described by a single
`EventMap`, and every method (`on`, `once`, `emit`, `any`, `pipe`, `next`, `scan`, `hook`) is checked against it.
It also ships with subscription lifecycle hooks, bus-to-bus piping, promise-based event awaiting, and built-in
memory-leak detection.

**[API Documentation v3 (current)](https://epferrari.github.io/strongbus/docs/3.0.0/)**
<br/>
**[API Documentation v2](https://epferrari.github.io/strongbus/docs/2.11.1/)**
<br/>
**[Migrating from v2 -> v3](./CHANGELOG.md#migrating-from-v2-to-v3)**

## Features

- **Type-safe by construction** — payloads are inferred from your event map; unknown events and mismatched
  payloads are compile errors.
- **Disposable subscriptions** — every subscriber returns a `Subscription` you can release.
- **[Lifecycle introspection](#lifecycle-hooks)** — hook into `active`/`idle` transitions, listener add/remove, and teardown.
- **[Incognito subscriptions](#incognito-subscriptions)** — `{incognito: true}` receives/forwards events without activating monitoring.
- **[Composable buses](#piping)** — `pipe` events from one bus into another (or into a function sink).
- **[Promise interop](#awaiting-events)** — `await` the next event with `next`, or resolve on a computed condition with `scan`.
- **[Configurable duplicate subscriptions](#options)** — `duplicateSubscriptionStrategy` controls counting, invoke,
  dispose, and logging for the same listenable+handler, with presets aligned to familiar APIs
  (`EventEmitter` (Node-style), `EventTarget` (Browser-style), `SharedHandler`).
- **[Memory-leak detection](#memory-leak-detection)** — configurable per-event listener thresholds with info/warn/error logging.

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

## Emitting events

`emit(event, payload)` returns a `boolean` indicating whether the event was handled (by an own listener, a
wildcard sink, or a downstream bus).

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

## Subscriptions

Every subscriber returns a `Subscription` — a function that releases the subscription. It can be disposed by
invoking it directly or via `.unsubscribe()`; both are idempotent. For Node `EventEmitter` familiarity,
`off(event, handler)` removes a handler by the same function reference passed to `on` (returns `void`).

```typescript
const sub = bus.on('message', handler);

sub();              // release
sub.unsubscribe();  // equivalent; safe to call again

// or, with the original handler reference:
bus.off('message', handler);
```

Prefer keeping the `Subscription` when you can; `off` is useful when the caller never stored it.
It only removes handlers registered with `on` — not wrappers from `once`, `any`, or `pipe`.

## Subscribing to events

### `on(event, handler, options?)`

Subscribe a handler to a single event. The handler receives the event's payload.
Duplicate registrations for the same event and handler reference are governed by the bus's
[`duplicateSubscriptionStrategy`](#options) (default: collapse — same `Subscription`,
one invoke, warn on duplicate). Optional `SubscribeOptions` (see
[Incognito subscriptions](#incognito-subscriptions)).

```typescript
bus.on('count', (n) => console.log(n)); // n: number
```

### `once(event, handler, options?)`

Like `on`, but automatically unsubscribes after the first time the event fires.
`once` honors `options.duplicateSubscriptionStrategy.{observability, invocation, logLevel}`, but disposal is
always frame-based and kind-isolated from `on` for the same handler (`off` never removes
`once` intent).

```typescript
bus.once('connected', () => console.log('connected exactly once'));
```

### `any(events, handler, options?)`

Subscribe one handler to several events. The handler receives the raised event as its first argument and the
payload as its second.

```typescript
bus.any(['message', 'count'], (event, payload) => {
  // event: 'message' | 'count'
  // payload: string | number
});
```

## Piping

`pipe` forwards every event from this bus into another `Bus` or into a function sink. Use `unpipe` to
detach.

### `pipe(bus, options?)` — downstream piping

Pipe into another `Bus`, counting the downstream's listeners as handlers on this bus (unless
`{incognito: true}` — see [Incognito subscriptions](#incognito-subscriptions)). Returns the downstream bus
(so pipes chain and subclasses are preserved). The downstream must be a real `Bus` instance.

```typescript
const producer = new Bus<Events>();
const leaf = new Bus<Events>();

producer.pipe(leaf);         // events emitted on `producer` are observed by `leaf`'s listeners
leaf.on('message', handle);

producer.emit('message', 'hi'); // `handle` is invoked

producer.unpipe(leaf);       // detach
```

### `pipe(sink, options?)` — function sink

Pipe *every* event into a function sink. The sink receives the raised event as a single correlated
`{event, payload}` message, plus a `forward` function bound to that message. This is the wildcard
subscription; the returned `Subscription` removes it (duplicate `pipe(sameSink)` follows
`duplicateSubscriptionStrategy`). Accepts the same `SubscribeOptions` as `on`.

```typescript
const stop = bus.pipe((piped) => {
  console.log(`${String(piped.event)}:`, piped.payload);
});

stop(); // stop receiving all events
```

Keeping the pair as one value means narrowing `piped.event` correlatively narrows `piped.payload`. To send the
event on to another bus, call `forward(dest)` rather than splitting the pair back into `(event, payload)` — this
queues a re-emit of the whole message on `dest` without a downstream link (so none of the listener-lifecycle
overhead `pipe(bus)` incurs). Queued emits run in the *delegation* phase after every own handler on the source
has returned (capture semantics). `forward` is live for the duration of that source `emit` and returns a
`Promise<boolean>` that resolves to `dest.emit`'s result, or `false` if `forward` is called after the emit
has completed:

```typescript
bus.pipe((piped, forward) => {
  if (piped.event === 'didRemoveItem') {
    cache.delete(piped.payload.id); // payload narrowed to this event's type
  }
  forward(other); // queues re-emit after this bus's own handlers
});
```

`forward`'s target is constrained exactly like `pipe(dest)`: every event `dest` declares must either
be absent from the source or carry the same payload type. It's therefore impossible to land an event on `dest`
with a payload type `dest` doesn't expect, and source-only events `dest` doesn't declare are simply dropped.
Because the sink never hands you a bare `(event, payload)` pair to re-`emit`, a mismatched pair can't be
fabricated — `emit` itself only accepts a correlated `(event, payload)`, never a `{event, payload}` object.

### `pipe(bus)` vs. `pipe(sink)`

There are two ways to aggregate events across buses, and they trade off differently.

**`root.pipe(leaf)` — downstream piping.** Reach for this when you need `root` to know *when listeners for
specific events are added or removed* through `leaf` — its `willAddListener` / `didAddListener` /
`willRemoveListener` / `didRemoveListener` hooks fire for the downstream's listeners — or when you have a *linear
chain* of buses. The downstream's listeners count toward `root`'s listener count, and pipes chain
(`node1.pipe(node2).pipe(node3)`).

```typescript
type Events = {foo: number};
const producer = new Bus<Events>();

let producing = false;
const produce = (payload: number) => {
  if (producing) {
    producer.emit('foo', payload);
  }
};

// `producer` reacts to demand for 'foo' anywhere downstream
producer.hook('didAddListener', (event) => { if (event === 'foo') producing = true; });
producer.hook('didRemoveListener', (event) => { if (event === 'foo') producing = false; });

const node1 = new Bus<Events>();
node1.on('foo', (payload) => console.log(`node 1 received event=foo, payload=${payload}`));
const node2 = new Bus<Events>();
node2.on('foo', (payload) => console.log(`node 2 received event=foo, payload=${payload}`));
const node3 = new Bus<Events>();
node3.on('foo', (payload) => console.log(`node 3 received event=foo, payload=${payload}`));

produce(1);           // producing === false, nothing emitted

producer.pipe(node1); // events flow producer -> node1; 'foo' now has a downstream listener
produce(1);           // logs "node 1 received event=foo, payload=1"

node1.pipe(node2);   // events flow producer -> node1 -> node2
node2.pipe(node3);   // events flow producer -> node1 -> node2 -> node3
produce(6);          // logs:
// "node 1 received event=foo, payload=6"
// "node 2 received event=foo, payload=6"
// "node 3 received event=foo, payload=6"

node2.unpipe(node3);
node1.unpipe(node2);
producer.unpipe(node1); // 'foo' has no downstream listeners again; `producing` flips back to false
produce(5); // logs nothing

// alternatively, using `hasListenersFor` and no `.hook`s
const produce = (payload: number) => {
  if(producer.hasListenersFor('foo')) {
    producer.emit('foo', payload);
  }
}
```

**`feeder.pipe((msg, forward) => forward(hub))` — forwarding sink.** Reach for this when you *don't* care about
listener add/remove bookkeeping, or when you have an *inverted tree* of many buses funneling into a single
`hub` and you attach your listeners on `hub`. A forwarding sink registers no downstream link, so it skips the
lifecycle-hook and listener-count overhead that `pipe(bus)` incurs.

```typescript
const hub = new Bus<Events>();
hub.on('foo', handleFoo);

const feederA = new Bus<Events>();
const feederB = new Bus<Events>();

feederA.pipe((msg, forward) => forward(hub)); // events flow feederA -> hub
feederB.pipe((msg, forward) => forward(hub)); // events flow feederB -> hub

feederA.emit('foo', payload);  // handleFoo called
feederB.emit('foo', payload);  // handleFoo called
```

See [Migrating from v2: `pipe(bus)` vs. forwarding sink](./CHANGELOG.md#pipebus-vs-forwarding-sink).

## Incognito subscriptions

Pass `{incognito: true}` as trailing `SubscribeOptions` on `on`, `once`, `any`, `pipe(sink)`,
`pipe(bus)`, `next`, or `scan` when the registration should still receive or forward events but must
**not** count toward this bus's monitoring subsystem:

- `active` / `idle` / `monitor`
- listener lifecycle hooks (`willAddListener` / `didAddListener` / remove pair)
- default introspection (`hasListeners`, `getListenerCount`, …)

```typescript
bus.on('message', logMessage, {incognito: true});
bus.pipe(telemetrySink, {incognito: true});
src.pipe(target, {incognito: true}); // forward events; target's listeners do not activate src
await bus.next('connected', {incognito: true});
```

`pipe(bus, {incognito: true})` still forwards events through the target (and any further chain). It does
not couple the target's listener tree into the source's monitoring; the target's own `active` / hooks
are unchanged. A second `pipe` of the same bus is a no-op (first mode sticks), matching idempotent `on`.

`off(event, handler)` still removes an incognito `on` registration by handler reference (no options).
The same behavior applies when releasing the returned `Subscription` or `unpipe` for `once` / `any` / `pipe`.

Memory-leak logger thresholds still count own incognito handlers (real retention). To include
incognito interest in queries, pass `{includeIncognito: true}` to introspection methods — that never
flips `active`.

## Awaiting events

### `next(resolutionTrigger, rejectionTrigger?, options?)`

Returns a `CancelablePromise` that resolves with `{event, payload}` when the resolution trigger fires. Optionally
provide a disjoint rejection trigger, and/or trailing `SubscribeOptions`. Triggers are a single event key or an
array of events (`SubscribableListenable`); `'*'` is not accepted.

```typescript
const {event, payload} = await bus.next('message');
// event: 'message', payload: string

const result = await bus.next(['message', 'connected', 'count']);

// resolve on either event; reject if `count` fires first
const result = await bus.next(['message', 'connected'], 'count');

await bus.next('message', {incognito: true});
await bus.next('message', 'count', {incognito: true});

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
- `pool` — reuse an in-flight scan that shares the same evaluator, eagerness, monitoring mode
  (`incognito`), and a superset trigger, instead of subscribing redundantly. Monitored and
  incognito scans never share a pool.
- `timeout` — cancel the scan after N milliseconds. Configuring a timeout disables pooling.
- `incognito` — wait without activating this bus's monitoring (see
  [Incognito subscriptions](#incognito-subscriptions)).

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

### Lifecycle hook ordering

Hooks follow **transition-centric** bracketing: activation and idle bracket the bus
going from 0→1 and 1→0 listeners.

**Direct `on()` / `unsubscribe()`** — one episode per listener. Adding two handlers
for the same event:

```
willActivate → willAdd → didAdd → active → willAdd → didAdd
```

Removing those two handlers:

```
willRemove → didRemove → willIdle → willRemove → didRemove → idle
```

`willActivate` / `willIdle` fire only on the 0↔1 transitions. `active` follows the
first `didAdd` that gives the bus demand; `willIdle` immediately precedes the
`willRemove` for the last listener.

**`pipe()` / `unpipe()` with pre-existing downstream listeners** — the upstream bus
reconciles the downstream snapshot using the same transition rules. With the
default `coalesceDownstreamLifecycleEvents: true`, reconcile emits one
`willAdd`/`didAdd` (or `willRemove`/`didRemove`) pair per event key when several
handlers share that key. Example: piping a downstream that already has two
listeners on `foo`:

```
willActivate → willAdd:foo → didAdd:foo → active
```

Unpiping that downstream when it was the bus's only demand:

```
willIdle → willRemove:foo → didRemove:foo → idle
```

Set `options.coalesceDownstreamLifecycleEvents: false` to get one hook pair per listener
during reconcile (matching the direct `on()` order above). Listener counts are
the same either way.

**After `pipe()`** — incremental adds/removes on the downstream bus still emit
hooks per listener; coalescing applies only to the initial `pipe()` / final
`unpipe()` reconcile.

**Partial `unpipe()`** — when other downstream or own listeners remain,
`willIdle` / `idle` are not emitted on the upstream bus.

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

The introspection methods take optional `IntrospectionOptions`:

- `scope?: ListenerScope` — which handlers to include; defaults to `ListenerScope.ANY`
- `includeIncognito?: boolean` — when `true`, include incognito own handlers and
  listeners reached via incognito `pipe(bus)` links; defaults to `false`

`ListenerScope`:

- `OWN` — registered directly on this bus (including function sinks from `pipe(handler)`)
- `DOWNSTREAM` — on buses attached with `pipe(bus)` only (monitored links by default;
  incognito-piped trees only when `includeIncognito: true`)
- `ANY` — `OWN | DOWNSTREAM` (equivalent alias, the default)

`bus.active` / `monitor` / lifecycle hooks always ignore incognito interest.

```typescript
import {Bus, ListenerScope} from 'strongbus';

bus.active;                                                          // boolean: monitored subscribers only
bus.hasListeners(/* options? */);                                    // any scope (default)
bus.getListenerCount(/* options? */);                                // total handlers in scope
bus.getListeners(/* options? */);                                    // union of all handlers in scope
bus.getEventCount(/* options? */);                                   // events with at least one listener in scope

bus.hasListenersFor('message', {scope: ListenerScope.OWN});
bus.getListenerCountFor('message', {scope: ListenerScope.DOWNSTREAM});
bus.getListenersFor('message', /* options? */);                        // empty set when none
bus.forEach((event, handlers) => { /* ... */ }, /* options? */);
bus.hasListeners({includeIncognito: true});
```

## Teardown

`destroy()` releases all event subscribers, fires `willDestroy`, removes all hooks, and detaches all downstreams.

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
- `verbose` — log on every listener past a threshold (`true`), or only at threshold boundaries
  (`false`, default).
- `duplicateSubscriptionStrategy` — how duplicate listenable+handler registrations behave for
  `on`, `any`, and `pipe(sink)` across four axes:

  | Axis | `collapse` | `stack` |
  |---|---|---|
  | **observability** | Count / lifecycle once | Each register adds a counted frame |
  | **invocation** | Handler runs once per emit | Handler runs once per stacked frame |
  | **disposal** | `sub()` / `off` clears the identity | Pops one frame |
  | **logLevel** | `never` \| `debug` \| `info` \| `warn` \| `error` | same |

  Defaults are all `collapse` with `logLevel: 'warn'`. Presets:

  ```typescript
  import {Bus, DuplicateSubscriptionStrategy} from 'strongbus';

  // EventEmitter-like (Node)
  new Bus({duplicateSubscriptionStrategy: DuplicateSubscriptionStrategy.EventEmitter});

  // DOM EventTarget-like (silent collapse)
  new Bus({duplicateSubscriptionStrategy: DuplicateSubscriptionStrategy.EventTarget});

  // Shared handler, independent owners (invoke once; dispose/off pops one)
  new Bus({duplicateSubscriptionStrategy: DuplicateSubscriptionStrategy.SharedHandler});
  ```

```typescript
const bus = new Bus<Events>({
  name: 'MyBus',
  allowUnhandledEvents: false,
  thresholds: {warn: 50},
  logger: console,
  duplicateSubscriptionStrategy: DuplicateSubscriptionStrategy.SharedHandler
});
```

See the [`Options`](https://epferrari.github.io/strongbus/interfaces/Options.html) and
[`ListenerThresholds`](https://epferrari.github.io/strongbus/interfaces/ListenerThresholds.html) API docs for the
canonical defaults and types.

Defaults for all instances can be set globally with `Bus.configure()`:

```typescript
Bus.configure({
  allowUnhandledEvents: false,
  thresholds: {warn: 50},
  logger: myLogger
});
```

`configure` recursively merges onto static defaults.

## Memory-leak detection

When the number of listeners for a single event crosses a configured threshold, Strongbus logs a message at the
corresponding severity (`info`/`warn`/`error`). This surfaces leaks from subscriptions that are never released.
With `verbose: false` (the default), messages are throttled to threshold boundaries and multiples rather than every listener. Set `verbose: true` to log on every listener added above a threshold.

## License

MIT
