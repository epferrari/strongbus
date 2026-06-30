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
  receives `(event, payload)` for every event raised; the returned
  `Subscription` removes it. This replaces the removed `proxy`/`every` methods.
- **`next(...)` resolves with `{event, payload}`** — a discriminated pair, so
  array and wildcard awaits can tell which event fired.
- **`EventSink<TEventMap>`** handler type — the `(event, payload)` handler shape
  used by `any` and the function-sink form of `pipe`.
- **`Logger` and `LoggerProvider`** types are now exported, for typing a custom
  `options.logger`.
- **`SubscriptionSurface<TEventMap>`** — the public subscribe-and-introspect API
  of `Bus`, excluding `emit`. Use it when a component should subscribe, await,
  pipe, or inspect listener state but must not raise events. `Bus` implements
  `SubscriptionSurface`.
- **`ListenerScope`** — selects own, delegate (piped bus), or combined (`ANY`)
  handlers for listener introspection. `ANY` is equivalent to
  `ListenerScope.OWN | ListenerScope.DELEGATE`. `DELEGATE` covers listeners on
  buses attached with `pipe(bus)` only, not function sinks from `pipe(handler)`.

### Changed (breaking)

- **Listener introspection** — scoped methods on `Bus` / `SubscriptionSurface`:
  `hasListeners`, `getListenerCount`, `getListeners`, `getEventCount`,
  `hasListenersFor`, `getListenerCountFor`, `getListenersFor`, and `forEach`
  (event-first callback). Pass a `ListenerScope` to select own, delegate, or
  combined handlers. `getListenersFor` returns an empty set when none are
  registered. `forEach` callback event keys are compile-time narrowed only; at
  runtime all registered keys are visited.

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

- **Variance:** a `Bus<Wide>` is assignable to `SubscriptionSurface<Narrow>`
  (and other contravariant views), so consumers can declare a narrower event map
  while still preventing subscription to events outside it. `scan`, `any`,
  `next`, `pipe`, and listener introspection methods participate in this narrowing.

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
| `bus.scan<typeof evaluator>(...)` | `bus.scan<ResolvedType>(...)` |
| `generateSubscription(dispose)` | `subscriptionWrapper(dispose)` |
| `EventHandler<Map, 'foo'>` | `SingleEventHandler<Map, 'foo'>` |
| `MultiEventHandler<Map>` | `EventSink<Map>` |
| `WildcardEventHandler<Map>` | `EventSink<Map>` |
| `GenericHandler` (exported) | *(internal; not part of the public API)* |
| `bus.listeners` | `bus.forEach((event, handlers) => ..., ListenerScope.ANY)` |
| `bus.listeners.get('foo')` | `bus.getListenersFor('foo', ListenerScope.ANY)` |
| `bus.ownListeners` | `bus.forEach((event, handlers) => ..., ListenerScope.OWN)` |
| `bus.hasListeners` *(property)* | `bus.hasListeners(ListenerScope.ANY)` |
| `bus.hasOwnListeners` | `bus.hasListeners(ListenerScope.OWN)` |
| `bus.hasDelegateListeners` | `bus.hasListeners(ListenerScope.DELEGATE)` |
| `bus.listenerCount` | `bus.getListenerCount(ListenerScope.ANY)` |
| `bus.listenerEventCount` | `bus.getEventCount(ListenerScope.ANY)` |
| `bus.ownListenerEventCount` | `bus.getEventCount(ListenerScope.OWN)` |
| `bus.delegateListenerEventCount` | `bus.getEventCount(ListenerScope.DELEGATE)` |
| `bus.hasListenersFor('foo')` | `bus.hasListenersFor('foo', ListenerScope.ANY)` |
| `bus.hasOwnListenersFor('foo')` | `bus.hasListenersFor('foo', ListenerScope.OWN)` |
| `bus.hasDelegateListenersFor('foo')` | `bus.hasListenersFor('foo', ListenerScope.DELEGATE)` |
| `bus.getListenerCountFor('foo')` | `bus.getListenerCountFor('foo', ListenerScope.ANY)` |
| `bus.getOwnListenerCountFor('foo')` | `bus.getListenerCountFor('foo', ListenerScope.OWN)` |
| `bus.getDelegateListenerCountFor('foo')` | `bus.getListenerCountFor('foo', ListenerScope.DELEGATE)` |
| `bus.getListener('foo')` | `bus.getListenersFor('foo', ListenerScope.ANY)` |
| `bus.getOwnListener('foo')` | `bus.getListenersFor('foo', ListenerScope.OWN)` |
| `bus.getDelegateListener('foo')` | `bus.getListenersFor('foo', ListenerScope.DELEGATE)` |
| `bus.getListenerCount('foo')` | `bus.getListenerCountFor('foo', ListenerScope.ANY)` |
| `bus.getOwnListenerCount('foo')` | `bus.getListenerCountFor('foo', ListenerScope.OWN)` |
| `bus.getDelegateListenerCount('foo')` | `bus.getListenerCountFor('foo', ListenerScope.DELEGATE)` |
| `bus.forEachListener((handlers, event) => ...)` | `bus.forEach((event, handlers) => ..., ListenerScope.ANY)` |
| `bus.forEachOwnListener((handlers, event) => ...)` | `bus.forEach((event, handlers) => ..., ListenerScope.OWN)` |
| `bus.forEachDelegateListener((handlers, event) => ...)` | `bus.forEach((event, handlers) => ..., ListenerScope.DELEGATE)` |

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
bus.pipe((event, payload) => { /* ... */ });                // '*' -> pipe
```

### `proxy` / `every` → `pipe`

Both are removed; `pipe` with a function sink covers them.

```typescript
// v2
const sub = bus.proxy((event, payload) => { /* ... */ });
const sub2 = bus.every((event, payload) => { /* ... */ });

// v3
const sub = bus.pipe((event, payload) => { /* ... */ });
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

### `scan` type argument

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

// v3 — single-event handlers and any/wildcard sinks
import type {SingleEventHandler, EventSink} from 'strongbus';
```

`MultiEventHandler` and `WildcardEventHandler` both map to `EventSink`. A
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

Prefer `SubscriptionSurface<Narrow>` over ad-hoc `Pick<Bus<Narrow>, ...>` when a
component should subscribe but not emit. A `Bus<Wide>` remains assignable to
`SubscriptionSurface<Narrow>`.

```typescript
// v3
import type {SubscriptionSurface} from 'strongbus';

function consume(source: SubscriptionSurface<Pick<MyEvents, 'foo' | 'bar'>>) {
  source.on('foo', handler);
  source.getListenerCountFor('foo', ListenerScope.ANY);
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

// v3
if (bus.hasListenersFor('foo', ListenerScope.ANY)) { /* ... */ }
const count = bus.getListenerCountFor('foo', ListenerScope.ANY);
const handlers = bus.getListenersFor('foo', ListenerScope.ANY);
bus.forEach((event, set) => { /* ... */ }, ListenerScope.ANY);
bus.forEach((event, set) => { /* ... */ }, ListenerScope.OWN);
bus.forEach((event, set) => { /* ... */ }, ListenerScope.DELEGATE);
```
