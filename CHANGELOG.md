# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - Unreleased

v3 tightens the subscription API around a smaller, more explicit set of methods
and makes `next` and `scan` easier to type. The behavioral core (emitting,
lifecycle hooks, piping, scanning, memory-leak detection) is unchanged.

See the [Migration guide](#migrating-from-v2-to-v3) for step-by-step changes.

### Added

- **`once(event, handler)`** — subscribe to a single event and automatically
  unsubscribe after the first emission.
- **`pipe(sink)` accepts a function sink** in addition to a `Bus`. The sink
  receives the raised event as a single correlated `{event, payload}` message plus
  a `forward` function bound to that message; the returned `Subscription` removes
  it. This replaces the removed `proxy`/`every` methods. Because `event` and
  `payload` travel as one value, discriminating on `message.event` correlatively
  narrows `message.payload`:

  ```ts
  bus.pipe((piped) => {
    if (piped.event === 'foo') {
      piped.payload.toUpperCase(); // narrowed to the 'foo' payload type
    } else if (piped.event === 'bar') {
      piped.payload.toString(2);   // narrowed to the 'bar' payload type
    }
  });
  ```

  To send the event on to another bus, call `forward(dst)` rather than splitting
  the pair back into `(event, payload)`. This re-emits the whole message on `dst`
  without registering a delegate (avoiding the listener-lifecycle overhead a
  delegate pipe incurs):

  ```ts
  bus.pipe((piped, forward) => {
    if (piped.event === 'didRemoveItem') {
      cache.delete(piped.payload.id);
    }
    forward(other); // re-emit the whole message on a payload-compatible bus
  });
  ```

  `forward`'s target is constrained exactly like a delegate `pipe(dst)`: every
  event `dst` declares must either be absent from the source or carry the same
  payload type, so it's impossible to land an event on `dst` with a payload it
  doesn't expect (source-only events are dropped). `PipeSink<TEventMap>` and
  `PipeForward<TEventMap>` are the exported types for this handler. `emit` itself
  stays strictly `(event, payload)` — it never accepts a `{event, payload}`
  object — so a mismatched pair can't be fabricated and re-emitted.

  (Earlier 3.0.0 betas used a 2-arity `(event, payload)` sink whose parameters
  were a union of `[event, payload]` tuples with an `[never, unknown]` member, and
  a brief `emit(message)` object form. Both are removed: the 2-arity sink could be
  destructured and re-emitted as an uncorrelated pair, and the object form invited
  hand-built messages — the correlated-message-plus-`forward` shape prevents both
  by construction.)
- **`next(...)` resolves with `{event, payload}`** — a discriminated pair, so
  multi-event awaits can tell which event fired. Wildcard (`'*'`) triggers are removed
  from `next` only; use `scan` with `trigger: '*'` when you need any-event listening
  with evaluator-side discrimination (see migration guide).
- **`EventSink<TEventMap>`** handler type — the `(event, payload)` handler shape
  used by `any`.
- **`Logger` and `LoggerProvider`** types are now exported, for typing a custom
  `options.logger`.
- **`ControlSurface<TEventMap>`** — `emit` and `destroy`.
- **`SubscriptionSurface<TEventMap>`** — subscribe, await, scan, and pipe (`on`, `once`, `any`, `next`, `scan`, `pipe`, `unpipe`). Use when a component should listen but must not raise events.
- **`IntrospectionSurface<TEventMap>`** — scoped listener introspection (`hasListeners`, `getListenerCount`, `getListeners`, `getEventCount`, `hasListenersFor`, `getListenerCountFor`, `getListenersFor`, `forEach`).
- **`MonitoringSurface<TEventMap>`** — lifecycle observation (`monitor`, `hook`, `active`).
- **`ListenerScope`** — selects own, delegate (piped bus), or combined (`ANY`)
  handlers for listener introspection. `ANY` is equivalent to
  `ListenerScope.OWN | ListenerScope.DELEGATE`. `DELEGATE` covers listeners on
  buses attached with `pipe(bus)` only, not function sinks from `pipe(handler)`.
- **`IntrospectionOptions`** — the `{scope?: ListenerScope}` options object
  accepted by the listener-introspection methods. Exported from the package root.
- **`Merge<Base, Ext>`** — a flattening event-map merge (overlapping keys take
  `Base`) for composing event maps. Unlike `Base & Ext`, `Merge` keeps indexed
  access concrete, so a generic base class (`new Bus<Merge<Fixed, TGeneric>>()`)
  can `emit` its fixed events with literal payloads without casting to `any`.
  See [Composing event maps](./README.md#composing-event-maps).

### Changed (breaking)

- **Listener introspection** — scoped methods on `Bus` / `IntrospectionSurface`:
  `hasListeners`, `getListenerCount`, `getListeners`, `getEventCount`,
  `hasListenersFor`, `getListenerCountFor`, `getListenersFor`, and `forEach`
  (event-first callback). Each takes an optional `{scope?: ListenerScope}`
  options argument to select own, delegate, or combined handlers; `scope`
  defaults to `ListenerScope.ANY`. `getListenersFor` returns an empty set when
  none are registered. `forEach` callback event keys are compile-time narrowed
  only; at runtime all registered keys are visited.

- **`emit(event, payload)` takes a single correlated payload** instead of a
  rest-spread (`emit(event, ...payload)`). The payload type is now `TEventMap[T]`
  directly, so a call type-checks even when the event map is a generic type
  parameter (e.g. `new Bus<TEvents>()` inside a generic base class) — previously
  the rest tuple `EventPayload<TEventMap, T>` failed to resolve against an
  abstract map. Payload is required for non-void events; void events may still be
  emitted as `emit(event)` or `emit(event, null)`. Anything the type system
  already accepted keeps working; only genuine multi-arg spreads (which were never
  typeable) are gone. `ControlSurface.emit` and `handleUnexpectedEvent` adopt the
  same correlated shape.
- **`emit` rejects an uncorrelated union `(event, payload)` pair.** A union-typed
  event key can no longer be paired with a union-typed payload without first
  discriminating on `event`. This closes a soundness hole where a pipe sink that
  split its message — `(message) => bus.emit(message.event, message.payload)` —
  forwarded a mismatched pair (both `event` and `payload` widened to unions, so
  `emit('foo', barPayload)` slipped through). Forward the whole message instead
  with the sink's `forward(dst)` argument, which keeps the pair correlated end to
  end. `emit` now layers three overloads: a
  void no-payload form, a single-key correlated form (`event: T, payload:
  TEventMap[T]`, guarded so a manifest union key collapses to `never`), and a
  correlated-tuple form for a genuinely generic key. Single-key emits — literal
  or a naked type parameter — are unchanged. **Caveat:** generic-key *forwarding*
  (`forward<K>(event: K, payload) => bus.emit(event, payload)`) is only preserved
  when the bus map is a naked type parameter (`Bus<M>`); over a computed mapped
  type such as `Merge<Fixed, TIncoming>`, TypeScript drops the `[K, M[K]]`
  correlation, so forward via the whole-map pattern instead.
- **`on(event, handler)` only accepts a single event key.** It no longer
  forwards arrays to `any` or `'*'` to `proxy`.
- **`next(...)` resolves with `{event, payload}`** instead of the bare payload
  (single event) or `undefined` (array/wildcard).
- **`scan<T>(...)`** — the type parameter is now the resolved value type rather
  than the evaluator type. Inference from a typed `evaluator` is unchanged.
- **Public handler types reduced** to `SingleEventHandler` and `EventSink`.
- **`generateSubscription` is renamed to `subscriptionWrapper`** (exported from
  the package root).

### Removed (breaking)

- **`proxy(handler)` and `every(handler)`** — use `pipe(handler)`.
- **`on('*', handler)` and `on([...], handler)`** overloads — use
  `pipe(handler)` and `any([...], handler)` respectively.
- **Handler types `EventHandler`, `MultiEventHandler`, `WildcardEventHandler`**
  — use `EventSink`.
- **`GenericHandler` is no longer exported** — it was an internal type.
- **Per-event listener helpers (v2)** — `hasListenersFor`, `getListenerCountFor`,
  etc. without a scope parameter.
- **`listeners` and `ownListeners` `ReadonlyMap` getters (v2).**
- **`hasListeners` / `hasOwnListeners` / `hasDelegateListeners` properties,
  `listenerCount`, and related per-scope method triplets** — use the scoped
  introspection API with `ListenerScope`.

### Fixed

- **Variance:** a `Bus<Wide>` is assignable to `SubscriptionSurface<Narrow>`,
  `IntrospectionSurface<Narrow>`, and other contravariant views, so consumers can
  declare a narrower event map while still preventing subscription to events
  outside it. `scan`, `any`, `next`, `pipe`, and listener introspection methods
  participate in this narrowing.

### Internal

- Extracted scanner pooling into a dedicated `ScannerPools` class.
- Expanded test coverage: logger thresholds and memory-pressure messages,
  error-handler failures, `subscriptionWrapper`, `emit` return value, and
  compile-time type-safety/variance assertions.

---

## Migrating from v2 to v3

| v2 (removed or changed) | v3 equivalent |
| --- | --- |
| `bus.on('*', handler)` | `bus.pipe(handler)` |
| `bus.on([...events], handler)` | `bus.any([...events], handler)` |
| `bus.proxy(handler)` | `bus.pipe(handler)` |
| `bus.every(handler)` | `bus.pipe(handler)` |
| `await bus.next('foo')` → payload | `const {payload} = await bus.next('foo')` |
| `await bus.next([...])` → `undefined` | `const {event, payload} = await bus.next([...])` |
| `bus.next('*', ...)` | `bus.next([...events])` or `bus.scan({evaluator, trigger: '*'})` — see [Wildcard (`'*'`) triggers on `next`](#wildcard--triggers-on-next) |
| `bus.scan({evaluator, trigger, ...})` | `bus.scan(trigger, evaluator, options?)` — object form deprecated |
| `bus.scan<typeof evaluator>(...)` | `bus.scan<ResolvedType>(...)` |
| `generateSubscription(dispose)` | `subscriptionWrapper(dispose)` |
| `EventHandler<Map, 'foo'>` | `SingleEventHandler<Map, 'foo'>` |
| `MultiEventHandler<Map>` | `EventSink<Map>` |
| `WildcardEventHandler<Map>` | `EventSink<Map>` |
| `GenericHandler` (exported) | *(internal; not part of the public API)* |
| `bus.listeners` | `bus.forEach((event, handlers) => ...)` or `bus.forEach((event, handlers) => ..., {scope: ListenerScope.ANY})` |
| `bus.listeners.get('foo')` | `bus.getListenersFor('foo')` or `bus.getListenersFor('foo', {scope: ListenerScope.ANY})` |
| `bus.ownListeners` | `bus.forEach((event, handlers) => ..., {scope: ListenerScope.OWN})` |
| `bus.hasListeners` *(property)* | `bus.hasListeners()` or `bus.hasListeners({scope: ListenerScope.ANY})` |
| `bus.hasOwnListeners` | `bus.hasListeners({scope: ListenerScope.OWN})` |
| `bus.hasDelegateListeners` | `bus.hasListeners({scope: ListenerScope.DELEGATE})` |
| `bus.listenerCount` | `bus.getListenerCount()` or `bus.getListenerCount({scope: ListenerScope.ANY})` |
| `bus.listenerEventCount` | `bus.getEventCount()` or `bus.getEventCount({scope: ListenerScope.ANY})` |
| `bus.ownListenerEventCount` | `bus.getEventCount({scope: ListenerScope.OWN})` |
| `bus.delegateListenerEventCount` | `bus.getEventCount({scope: ListenerScope.DELEGATE})` |
| `bus.hasListenersFor('foo')` | `bus.hasListenersFor('foo')` or `bus.hasListenersFor('foo', {scope: ListenerScope.ANY})` |
| `bus.hasOwnListenersFor('foo')` | `bus.hasListenersFor('foo', {scope: ListenerScope.OWN})` |
| `bus.hasDelegateListenersFor('foo')` | `bus.hasListenersFor('foo', {scope: ListenerScope.DELEGATE})` |
| `bus.getListenerCountFor('foo')` | `bus.getListenerCountFor('foo')` or `bus.getListenerCountFor('foo', {scope: ListenerScope.ANY})` |
| `bus.getOwnListenerCountFor('foo')` | `bus.getListenerCountFor('foo', {scope: ListenerScope.OWN})` |
| `bus.getDelegateListenerCountFor('foo')` | `bus.getListenerCountFor('foo', {scope: ListenerScope.DELEGATE})` |
| `bus.getListener('foo')` | `bus.getListenersFor('foo')` or `bus.getListenersFor('foo', {scope: ListenerScope.ANY})` |
| `bus.getOwnListener('foo')` | `bus.getListenersFor('foo', {scope: ListenerScope.OWN})` |
| `bus.getDelegateListener('foo')` | `bus.getListenersFor('foo', {scope: ListenerScope.DELEGATE})` |
| `bus.getListenerCount('foo')` | `bus.getListenerCountFor('foo')` or `bus.getListenerCountFor('foo', {scope: ListenerScope.ANY})` |
| `bus.getOwnListenerCount('foo')` | `bus.getListenerCountFor('foo', {scope: ListenerScope.OWN})` |
| `bus.getDelegateListenerCount('foo')` | `bus.getListenerCountFor('foo', {scope: ListenerScope.DELEGATE})` |
| `bus.forEachListener((handlers, event) => ...)` | `bus.forEach((event, handlers) => ...)` or `bus.forEach((event, handlers) => ..., {scope: ListenerScope.ANY})` |
| `bus.forEachOwnListener((handlers, event) => ...)` | `bus.forEach((event, handlers) => ..., {scope: ListenerScope.OWN})` |
| `bus.forEachDelegateListener((handlers, event) => ...)` | `bus.forEach((event, handlers) => ..., {scope: ListenerScope.DELEGATE})` |

Import `ListenerScope` from `'strongbus'` wherever the v3 column uses it. `ListenerScope.ANY` is equivalent to `ListenerScope.OWN | ListenerScope.DELEGATE`. `ListenerScope.DELEGATE` covers listeners on buses attached with `pipe(bus)` only, not function sinks from `pipe(handler)` (those are `ListenerScope.OWN`).

### `on` with arrays or the wildcard

`on` is now single-event only. Move array and wildcard subscriptions to `any`
and `pipe`.

```typescript
// v2
bus.on('foo', onFoo);
bus.on(['foo', 'bar'], (event, payload) => { /* ... */ });
bus.on('*', (event, payload) => { /* ... */ });

// v3
bus.on('foo', onFoo);                                       // unchanged
bus.any(['foo', 'bar'], (event, payload) => { /* ... */ }); // arrays -> any
bus.pipe(({event, payload}) => { /* ... */ });                       // '*' -> pipe
```

### `proxy` / `every` → `pipe`

Both are removed; `pipe` with a function sink covers them.

```typescript
// v2
const sub = bus.proxy((event, payload) => { /* ... */ });
const sub2 = bus.every((event, payload) => { /* ... */ });

// v3 — the sink receives one correlated { event, payload } message
const sub = bus.pipe(({event, payload}) => { /* ... */ });
```

### `next` resolves with `{event, payload}`

```typescript
// v2
const payload = await bus.next('foo');        // payload: TEventMap['foo']
await bus.next(['foo', 'bar']);               // resolved with undefined

// v3
const {payload} = await bus.next('foo');      // payload: TEventMap['foo']
const {event, payload} = await bus.next(['foo', 'bar']);
// event is narrowed to 'foo' | 'bar'; payload is the matching payload type
```

### Wildcard (`'*'`) triggers on `next`

`next` no longer accepts `'*'` as a resolution or rejection trigger. `next` always resolves on the first
matching event. In the type system, the wider events are transparent to the narrower bus, however at runtime they do get piped into the narrower bus, so a wildcard handler could unintentionally resolve/reject a `next` on an event the narrow bus is oblivous to.

`scan` still accepts `trigger: '*'` because the evaluator can discriminate on `resolve.trigger` before
resolving.

```typescript
// before — compile-time allowed on next, payload typing was unsound
await bus.next('*');

// after — list events when using next
await bus.next(['foo', 'bar', 'baz']);

// after — wildcard with conditional resolve via scan
await bus.scan('*', (resolve) => {
  if (resolve.trigger.type === 'event' && shouldAccept(resolve.trigger)) {
    resolve(resolve.trigger);
  }
});
```

### `scan` signature

```typescript
// v3 (preferred)
bus.scan<boolean>('foo', myEvaluator);
bus.scan<boolean>('foo', myEvaluator, {eager: false, pool: false, timeout: 1000});

// v3 (deprecated object form — still supported)
bus.scan<boolean>({evaluator: myEvaluator, trigger: 'foo'});
```

The type argument is the resolved value type. Inference from a typed `evaluator` is unchanged.

```typescript
// explicit resolved-value type argument
bus.scan<boolean>('foo', myEvaluator);

// inference is unchanged in both forms
const ready = await bus.scan('foo', myEvaluator);
```

### `scan` type argument (evaluator type parameter removed in v3)

The type argument is now the resolved value type. Inference from a typed
`evaluator` is unaffected; only an explicit type argument changes.

```typescript
// v2 — explicit evaluator type argument
bus.scan<typeof myEvaluator>({evaluator: myEvaluator, trigger: 'foo'});

// v3 — explicit resolved-value type argument
bus.scan<boolean>({evaluator: myEvaluator, trigger: 'foo'});

// inference is unchanged in both versions
const ready = await bus.scan({evaluator: myEvaluator, trigger: 'foo'});
```

### Renamed handler types

```typescript
// v2
import type {EventHandler, MultiEventHandler, WildcardEventHandler} from 'strongbus';

// v3 — single-event handlers, any sinks, and the pipe message sink
import type {SingleEventHandler, EventSink, PipeSink} from 'strongbus';
```

`MultiEventHandler` maps to `EventSink` (the `(event, payload)` handler used by
`any`). `WildcardEventHandler` maps to `PipeSink`, whose sink now receives a
single correlated `{event, payload}` message (`pipe((message) => …)`). A
single-event handler that was typed via `EventHandler<Map, 'foo'>` is now
`SingleEventHandler<Map, 'foo'>`.

### Renamed subscription helper

```typescript
// v2
import {generateSubscription} from 'strongbus';

// v3
import {subscriptionWrapper} from 'strongbus';
```

### Narrower consumer views

Prefer `SubscriptionSurface<Narrow>` when a component should subscribe but not emit, or `IntrospectionSurface<Narrow>` when it only inspects listeners. A `Bus<Wide>` remains assignable to either narrower view.

```typescript
// v3
import type {SubscriptionSurface, IntrospectionSurface} from 'strongbus';

function consume(source: SubscriptionSurface<Pick<MyEvents, 'foo' | 'bar'>>) {
  source.on('foo', handler);
}

function inspect(source: IntrospectionSurface<Pick<MyEvents, 'foo' | 'bar'>>) {
  source.getListenerCountFor('foo');
}
```

### Listener introspection

```typescript
import {ListenerScope} from 'strongbus';

// v2
if (bus.hasListenersFor('foo')) { /* ... */ }
const count = bus.getListenerCountFor('foo');
const handlers = bus.listeners.get('foo');
for (const [event, set] of bus.listeners) { /* ... */ }

// v3 (scope is optional, defaults to ListenerScope.ANY)
if (bus.hasListenersFor('foo')) { /* ... */ }
const count = bus.getListenerCountFor('foo');
const handlers = bus.getListenersFor('foo');
bus.forEach((event, set) => { /* ... */ });
bus.forEach((event, set) => { /* ... */ }, {scope: ListenerScope.OWN});
bus.forEach((event, set) => { /* ... */ }, {scope: ListenerScope.DELEGATE});
```
