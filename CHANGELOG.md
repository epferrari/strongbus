# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - Unreleased

v3 tightens the subscription API around a smaller, more explicit set of methods
and makes `next` and `scan` easier to type. The behavioral core (emitting,
piping, scanning, memory-leak detection) is largely unchanged; lifecycle hook
ordering and downstream piping behavior are tightened (see **Fixed** and **Changed**
below).

See the [Migration guide](#migrating-from-v2-to-v3) for step-by-step changes.

### Added

- **`duplicateSubscriptionStrategy`** — bus option controlling duplicate listenable+handler
  registrations along four axes (`observability`, `invocation`, `disposal`, `logLevel`), each
  `collapse` | `stack` except `logLevel` (`never` | `debug` | `info` | `warn` | `error`).
  Defaults are all `collapse` with `logLevel: 'warn'` (warns on duplicates; emit/count still
  collapsed). Applies fully to `on`, `any`, and `tap`. `once` honors observability,
  invocation, and logLevel with kind-isolated disposal (`off` / disposing `on` never clears
  `once` for the same handler, and vice versa). Named presets:
  `DuplicateSubscriptionStrategy.EventEmitter`, `.EventTarget`, `.SharedHandler`.
  **`Logger.debug` is now required** on custom loggers (used when
  `duplicateSubscriptionStrategy.logLevel` is `'debug'`).
- **`once(event, handler)`** — subscribe to a single event and automatically
  unsubscribe after the first emission.
- **`off(event, handler)`** — remove a handler previously registered with `on` by
  the same function reference. Returns `void` (not the bus). Prefer the
  `Subscription` from `on` when available; `off` does not remove wrappers from
  `once`, `any`, or `tap`.
- **`SubscribeOptions` / `{incognito: true}`** — optional trailing options on
  `on`, `once`, `any`, `tap`, `pipe(bus)`, `next`, and `scan`. An
  incognito registration still receives or forwards events but does not count
  toward this bus's monitoring (`active` / `idle`, `monitor`, listener lifecycle
  hooks, or default introspection). `pipe(bus, {incognito: true})` forwards
  events without coupling the target's listener tree into the source's
  monitoring (the target's own monitoring is unchanged). Duplicate `on` with the
  same handler under default `duplicateSubscriptionStrategy` keeps the first
  registration's mode. Memory-leak logger thresholds
  still count own incognito handlers. `ScanOptions` extends `SubscribeOptions`;
  pooled scans never share a scanner across different `incognito` modes. See
  [Incognito subscriptions](./README.md#incognito-subscriptions).
- **`tap(handler)`** — observe every raised event as a correlated `{event, payload}`
  message without creating a graph edge. Replaces the old `pipe(sink)` observer role
  (and removes `forward`). Discriminating on `message.event` correlatively narrows
  `message.payload`. `TapHandler` / `PipedMessage` are the exported types.
  Duplicate `tap` follows `duplicateSubscriptionStrategy`.

  ```ts
  bus.tap((piped) => {
    if (piped.event === 'foo') {
      piped.payload.toUpperCase();
    }
  });
  ```

- **`pipe(pred).pipe(dest)`** — call-site filter for multi-hop relay. Unfiltered
  outbound edges from a bus that already has inbound pipes warn once per unique unsound path and
  block passthrough; local raises still deliver. See [docs/pipe_limitations.md](./docs/pipe_limitations.md).
- **`ASSUMED_SOUND_EDGE`** — exported `() => true` pipe predicate for
  `bus.pipe(ASSUMED_SOUND_EDGE).pipe(dest)`, signaling that the author of the calling code trusts the multi-hop path is sound.
- **`EventSink<TEventMap>`** handler type — the `(event, payload)` handler shape
  used by `any`.
- **`StrongbusLogRecord`** / **`StrongbusLogCode`** — Strongbus-authored log lines
  are `{code, message, context?}` records with stable numeric codes. Custom
  `options.logger` implementations receive `level(record)` and can discriminate on
  `record.code`; structured extras (e.g. error-handler failure details) live on
  optional `record.context`. Both are exported from the package root.
- **`Logger` and `LoggerProvider`** — `Logger` methods are typed as
  `(record: StrongbusLogRecord) => void`. Exported for typing a custom
  `options.logger`.
- **`defaultConsoleLogger`** — default `options.logger`; writes `record.message`
  (and `record.context` when present) to `console`.
- **`ControlSurface<TEventMap>`** — `emit` and `destroy`.
- **`SubscriptionSurface<TEventMap>`** — subscribe, await, scan, and pipe (`on`, `once`, `off`, `any`,
  `next`, `scan`, `tap`, `pipe`, `unpipe`), including optional `SubscribeOptions` on subscribe/pipe/await
  methods. Use when a component should listen but must not raise events.
- **`IntrospectionSurface<TEventMap>`** — scoped listener introspection (`hasListeners`, `getListenerCount`, `getListeners`, `getEventCount`, `hasListenersFor`, `getListenerCountFor`, `getListenersFor`, `forEach`).
- **`MonitoringSurface<TEventMap>`** — lifecycle observation (`monitor`, `hook`, `active`).
- **`ListenerScope`** — selects own, downstream (piped bus), or combined (`ANY`)
  handlers for listener introspection. `ANY` is equivalent to
  `ListenerScope.OWN | ListenerScope.DOWNSTREAM`. `DOWNSTREAM` covers listeners on
  buses attached with `pipe(bus)` only, not `tap` handlers.
- **`IntrospectionOptions`** — `{scope?: ListenerScope; includeIncognito?: boolean}`
  accepted by the listener-introspection methods. `includeIncognito` defaults to
  `false` (incognito own handlers and incognito-piped trees are omitted).
  Lifecycle / `active` / `monitor` never consult this flag. Exported from the
  package root along with **`SubscribeOptions`**.
- **`Bus.configure(options)`** — merge partial `Options` (except `name`) onto static defaults for
  all subsequently constructed instances. Nested `thresholds` are merged recursively. Use the
  constructor for per-instance `name`.
- **`Merge<Base, Ext>`** — a flattening event-map merge (overlapping keys take
  `Base`) for composing event maps. Unlike `Base & Ext`, `Merge` keeps indexed
  access concrete, so a generic base class (`new Bus<Merge<Fixed, TGeneric>>()`)
  can `emit` its fixed events with literal payloads without casting to `any`.
  See [Composing event maps](./README.md#composing-event-maps).
- **`options.coalesceDownstreamLifecycleEvents`** (default `true`) — when `true`, a
  source bus emits at most one `willAddListener` / `didAddListener` (and matching
  remove hooks) per event key per downstream lifecycle episode during `pipe()` /
  `unpipe()` reconcile when the downstream bus already has listeners, instead of once
  per downstream handler. Listener counts and introspection are unchanged; only hook
  emissions are coalesced for that reconcile. Incremental downstream listener changes
  after the link is established still emit hooks per listener. Set to `false` for one
  hook pair per listener during reconcile (see [Lifecycle hook ordering](./README.md#lifecycle-hook-ordering)).

### Changed

- **`Logger.debug` is required** — custom `options.logger` implementations must
  provide `debug(...args)`. Strongbus invokes it when
  `duplicateSubscriptionStrategy.logLevel` is `'debug'`. (`console` already
  satisfies this.)
- **Listener introspection** — scoped methods on `Bus` / `IntrospectionSurface`:
  `hasListeners`, `getListenerCount`, `getListeners`, `getEventCount`,
  `hasListenersFor`, `getListenerCountFor`, `getListenersFor`, and `forEach`
  (event-first callback). Each takes optional `IntrospectionOptions`
  (`scope` and/or `includeIncognito`); `scope` defaults to `ListenerScope.ANY`
  and `includeIncognito` defaults to `false`. `getListenersFor` returns an empty
  set when none are registered. `forEach` callback event keys are compile-time
  narrowed only; at runtime all registered keys are visited.

- **`on(event, handler)` is reference-idempotent** with default `options.duplicateSubscriptionStrategy` — a second `on` with the same
  event and handler returns the existing `Subscription` (one emit invocation, one
  remove lifecycle).
- **`emit(event, payload)` takes a single correlated payload** instead of a
  rest-spread (`emit(event, ...payload)`). The payload type is now `TEventMap[T]`
  directly, so a call type-checks even when the event map is a generic type
  parameter (e.g. `new Bus<TEvents>()` inside a generic base class) — previously
  the rest tuple `EventPayload<TEventMap, T>` failed to resolve against an
  abstract map. Payload is required for non-void events; void events may still be
  emitted as `emit(event)` or `emit(event, null)`. Anything the type system
  already accepted keeps working; only genuine multi-arg spreads (which were never
  typeable) are gone. Generic-key forwarding (`emit<K extends keyof M>(event: K, payload: M[K])`)
  works over concrete maps. `ControlSurface.emit` adopts the same correlated shape. A
  correlated-tuple overload remains for call sites that discriminated on `event` first.
  Observers use `tap` and receive `{event, payload}` as one value; graph edges use `pipe(bus)` rather
  than splitting the pair.
- **`options.onUnhandledEvent`** replaces **`allowUnhandledEvents`** — `'ignore'` (default),
  `'throw'`, or a `(event, payload) => void` callback. Subclassing `handleUnexpectedEvent` is
  no longer the customization path; pass a callback (or `'throw'`) instead.
  `Bus.defaultAllowUnhandledEvents = false` still maps to `configure({onUnhandledEvent: 'throw'})`.
- **`PipePayloadOverlap` uses tuple equality (`[A] extends [B]`)** so narrow-to-wide
  `pipe`/`forward` targets type-check when the source map is an open generic and
  the downstream map is a concrete superset (e.g. `_incomingPushBus.pipe(_bus)`).
  Shared keys also allow a one-way widen within the same primitive family
  (`string` / `boolean` / `number`, including literal unions such as
  `'a'|'b' → string` or `1|2 → number`); object and other structured payloads
  still require an exact match. The unsafe reverse (`string → 'a'|'b'`) remains
  a type error.

- **`pipe(bus)` returns the concrete downstream type** (`TDownstream`), preserving
  subclasses for chaining (e.g. `head.pipe(mid).pipe(tail)`).
- **`on(event, handler)` only accepts a single event key.** It no longer
  forwards arrays to `any` or `'*'` to `proxy`.
- **`next(...)` resolves with `{event, payload}`** instead of the bare payload
  (single event) or `undefined` (array/wildcard). Wildcard (`'*'`) triggers are
  not accepted; use `scan` with `trigger: '*'` when you need any-event listening
  with evaluator-side discrimination (see migration guide).
- **`scan<T>(...)`** — the type parameter is now the resolved value type rather
  than the evaluator type. Inference from a typed `evaluator` is unchanged.
- **Public handler types reduced** to `EventHandler` and `EventSink`.
- **`generateSubscription` is renamed to `subscriptionWrapper`** (exported from
  the package root).
- **Lifecycle hook ordering** — transition-centric bracketing on every bus. See
  [Lifecycle hook ordering](./README.md#lifecycle-hook-ordering) in the README.
- **`options.verbose` default is now `false`** — memory-leak threshold messages log at
  boundaries and multiples only. v2 defaulted to `true` (every listener above a
  threshold). Set `verbose: true` in constructor or globally with `Bus.configure({verbose: true}` to restore v2-style logging.

### Deprecated

- **`SingleEventHandler`** — deprecated alias for **`EventHandler`**.
- **`Bus.defaultAllowUnhandledEvents`**, **`Bus.defaultThresholds`**, **`Bus.defaultLogger`**,
  and **`Bus.verbose`** static setters — use **`Bus.configure()`** instead.

### Removed

- **`options.allowUnhandledEvents`** — use **`options.onUnhandledEvent`** (`'ignore'` |
  `'throw'` | callback).
- **`Bus#handleUnexpectedEvent`** — override path removed; use `onUnhandledEvent: 'throw'` or
  a callback.
- **`proxy(handler)` and `every(handler)`** — use `tap(handler)`.
- **`on('*', handler)` and `on([...], handler)`** overloads — use
  `tap(handler)` and `any([...], handler)` respectively.
- **Handler types `MultiEventHandler`, `WildcardEventHandler`**
  — use `EventSink` (for `any`) or `TapHandler` (for `tap`).
- **`GenericHandler` is no longer exported** — it was an internal type.
- **Per-event listener helpers (v2)** — `hasListenersFor`, `getListenerCountFor`,
  etc. without a scope parameter.
- **`listeners` and `ownListeners` `ReadonlyMap` getters (v2).**
- **`hasListeners` / `hasOwnListeners` / `hasDownstreamListeners` properties,
  `listenerCount`, and related per-scope method triplets** — use the scoped
  introspection API with `ListenerScope`.

### Fixed

- **Downstream listeners before `pipe()`** — when a downstream already has listeners
  (including via nested `pipe` links) at the moment `pipe(bus)` runs, the upstream
  bus now bubbles the corresponding add-listener lifecycle hooks, updates listener
  counts, and transitions to `active` as if those handlers had been present from the
  start. `unpipe` symmetrically bubbles remove hooks, clears downstream-scoped
  introspection, and marks the upstream bus idle when that downstream was its only
  remaining listener demand. `willIdle` / `idle` are not emitted when another downstream
  (or own listener) still has demand.
- **Variance:** a `Bus<Wide>` is assignable to `SubscriptionSurface<Narrow>`,
  `IntrospectionSurface<Narrow>`, and other contravariant views, so consumers can
  declare a narrower event map while still preventing subscription to events
  outside it. `scan`, `any`, `next`, `pipe`, and listener introspection methods
  participate in this narrowing.

### Internal

- Extracted lifecycle orchestration into `LifecycleManager` (`lifecycleManager.ts`).
- Extracted scanner pooling into a dedicated `ScannerPools` class.
- Expanded test coverage: logger thresholds and memory-pressure messages,
  error-handler failures, `subscriptionWrapper`, `emit` return value, and
  compile-time type-safety/variance assertions.

---

## Migrating from v2 to v3

| v2 (removed or changed) | v3 equivalent |
| --- | --- |
| `bus.on('*', handler)` | `bus.tap(handler)` |
| `allowUnhandledEvents: false` | `options.onUnhandledEvent: 'throw'` |
| `allowUnhandledEvents: true` (default) | `options.onUnhandledEvent: 'ignore'` (default) or omit |
| subclass `handleUnexpectedEvent` | `options.onUnhandledEvent: (event, payload) => { ... }` |
| `feeder.on('*', hub.emit)` | `feeder.pipe(hub)` |
| `bus.on([...events], handler)` | `bus.any([...events], handler)` |
| `bus.proxy(handler)` | `bus.tap(handler)` |
| `bus.every(handler)` | `bus.tap(handler)` |
| `const payload = await bus.next('foo')` → payload | `const {payload} = await bus.next('foo')` |
| `await bus.next([...])` → `undefined` | `const {event, payload} = await bus.next([...])` |
| `bus.next('*', ...)` | `bus.next([...events])` or `bus.scan('*', evaluator, options?)` — see [Wildcard (`'*'`) triggers on `next`](#wildcard--triggers-on-next) |
| `bus.scan({evaluator, trigger, ...})` | `bus.scan(trigger, evaluator, options?)` — object form deprecated |
| `bus.scan<typeof evaluator>(...)` | `bus.scan<ResolvedType>(...)` |
| `generateSubscription(dispose)` | `subscriptionWrapper(dispose)` |
| `EventHandler<Map, 'foo'>` | `EventHandler<Map, 'foo'>` (unchanged) |
| `MultiEventHandler<Map>` | `EventSink<Map>` |
| `WildcardEventHandler<Map>` | `TapHandler<Map>` |
| `GenericHandler` (exported) | *(internal; not part of the public API)* |
| `bus.listeners` | `bus.forEach((event, handlers) => ...)` or `bus.forEach((event, handlers) => ..., {scope: ListenerScope.ANY})` |
| `bus.listeners.get('foo')` | `bus.getListenersFor('foo')` or `bus.getListenersFor('foo', {scope: ListenerScope.ANY})` |
| `bus.ownListeners` | `bus.forEach((event, handlers) => ..., {scope: ListenerScope.OWN})` |
| `bus.hasListeners` *(property)* | `bus.hasListeners()` or `bus.hasListeners({scope: ListenerScope.ANY})` |
| `bus.hasOwnListeners` | `bus.hasListeners({scope: ListenerScope.OWN})` |
| `bus.hasDownstreamListeners` | `bus.hasListeners({scope: ListenerScope.DOWNSTREAM})` |
| `bus.listenerCount` | `bus.getListenerCount()` or `bus.getListenerCount({scope: ListenerScope.ANY})` |
| `bus.listenerEventCount` | `bus.getEventCount()` or `bus.getEventCount({scope: ListenerScope.ANY})` |
| `bus.ownListenerEventCount` | `bus.getEventCount({scope: ListenerScope.OWN})` |
| `bus.downstreamListenerEventCount` | `bus.getEventCount({scope: ListenerScope.DOWNSTREAM})` |
| `bus.hasListenersFor('foo')` | `bus.hasListenersFor('foo')` or `bus.hasListenersFor('foo', {scope: ListenerScope.ANY})` |
| `bus.hasOwnListenersFor('foo')` | `bus.hasListenersFor('foo', {scope: ListenerScope.OWN})` |
| `bus.hasDownstreamListenersFor('foo')` | `bus.hasListenersFor('foo', {scope: ListenerScope.DOWNSTREAM})` |
| `bus.getListenerCountFor('foo')` | `bus.getListenerCountFor('foo')` or `bus.getListenerCountFor('foo', {scope: ListenerScope.ANY})` |
| `bus.getOwnListenerCountFor('foo')` | `bus.getListenerCountFor('foo', {scope: ListenerScope.OWN})` |
| `bus.getDownstreamListenerCountFor('foo')` | `bus.getListenerCountFor('foo', {scope: ListenerScope.DOWNSTREAM})` |
| `bus.getListener('foo')` | `bus.getListenersFor('foo')` or `bus.getListenersFor('foo', {scope: ListenerScope.ANY})` |
| `bus.getOwnListener('foo')` | `bus.getListenersFor('foo', {scope: ListenerScope.OWN})` |
| `bus.getDownstreamListener('foo')` | `bus.getListenersFor('foo', {scope: ListenerScope.DOWNSTREAM})` |
| `bus.getListenerCount('foo')` | `bus.getListenerCountFor('foo')` or `bus.getListenerCountFor('foo', {scope: ListenerScope.ANY})` |
| `bus.getOwnListenerCount('foo')` | `bus.getListenerCountFor('foo', {scope: ListenerScope.OWN})` |
| `bus.getDownstreamListenerCount('foo')` | `bus.getListenerCountFor('foo', {scope: ListenerScope.DOWNSTREAM})` |
| `bus.forEachListener((handlers, event) => ...)` | `bus.forEach((event, handlers) => ...)` or `bus.forEach((event, handlers) => ..., {scope: ListenerScope.ANY})` |
| `bus.forEachOwnListener((handlers, event) => ...)` | `bus.forEach((event, handlers) => ..., {scope: ListenerScope.OWN})` |
| `bus.forEachDownstreamListener((handlers, event) => ...)` | `bus.forEach((event, handlers) => ..., {scope: ListenerScope.DOWNSTREAM})` |
| custom `Logger` with only `info`/`warn`/`error` | add required `debug(...args)` |

Import `ListenerScope` from `'strongbus'` wherever the v3 column uses it. `ListenerScope.ANY` is equivalent to `ListenerScope.OWN | ListenerScope.DOWNSTREAM`. `ListenerScope.DOWNSTREAM` covers listeners on buses attached with `pipe(bus)` only, not `tap` handlers (those are `ListenerScope.OWN`).

### Custom `Logger` must implement `debug`

`Logger` now requires `debug(...args: any[]): void` alongside `info` / `warn` / `error`.
Strongbus calls it when `options.duplicateSubscriptionStrategy.logLevel` is `'debug'`.
`console` already implements `debug`; custom loggers need an explicit method (even a no-op).

### `on` with arrays or the wildcard

`on` is now single-event only. Move array and wildcard subscriptions to `any`
and `tap`.

```typescript
// v2
bus.on('foo', onFoo);
bus.on(['foo', 'bar'], (event, payload) => { /* ... */ });
bus.on('*', (event, payload) => { /* ... */ });

// v3
bus.on('foo', onFoo);                                       // unchanged
bus.any(['foo', 'bar'], (event, payload) => { /* ... */ }); // arrays -> any
bus.tap(({event, payload}) => { /* ... */ });               // '*' -> tap
```

### `proxy` / `every` → `tap`

Both are removed; `tap` covers them.

```typescript
// v2
const sub = bus.proxy((event, payload) => { /* ... */ });
const sub2 = bus.every((event, payload) => { /* ... */ });

// v3 — the handler receives one correlated { event, payload } message
const sub = bus.tap(({event, payload}) => { /* ... */ });
```

### Hubs: `feeder.pipe(hub)`

v2 often used `feeder.on('*', hub.emit)`. v3 removes the `'*'` subscription; pipe feeders
into the hub directly:

```ts
feeder.pipe(hub);
```

For multi-hop bridges with disagreeing maps, use `mid.pipe(pred).pipe(leaf)` — see
[docs/pipe_limitations.md](./docs/pipe_limitations.md).

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
matching event. In the type system, the wider events are transparent to the narrower bus, however at runtime they do get piped into the narrower bus, so a wildcard handler could unintentionally resolve/reject a `next` on an event the narrow bus is oblivious to.

`scan` still accepts `trigger: '*'` because the evaluator can discriminate on `resolve.trigger` before
resolving.

```typescript
// before — compile-time allowed on next, payload typing was unsound
await bus.next('*');

// v3 — list events when using next
await bus.next(['foo', 'bar', 'baz']);

// v3 — wildcard with conditional resolve via scan
await bus.scan('*', (resolve) => {
  if (resolve.trigger.type === 'event' && shouldAccept(resolve.trigger)) {
    resolve(resolve.trigger);
  }
});
```

### `scan` signature and type argument

The positional form is preferred. The object form
`scan({evaluator, trigger, ...options})` is deprecated but still supported. The
type argument is the resolved value type (not the evaluator type). Inference from
a typed `evaluator` is unchanged.

```typescript
// v2
bus.scan<typeof myEvaluator>({evaluator: myEvaluator, trigger: 'foo'});

// v3 (preferred)
bus.scan<boolean>('foo', myEvaluator);
bus.scan<boolean>('foo', myEvaluator, {eager: false, pool: false, timeout: 1000});

// v3 (deprecated object form — still supported)
bus.scan<boolean>({evaluator: myEvaluator, trigger: 'foo'});

// inference is unchanged in both versions
const ready = await bus.scan('foo', myEvaluator);
```

### Renamed handler types

```typescript
// v2
import type {EventHandler, MultiEventHandler, WildcardEventHandler} from 'strongbus';

// v3 — single-event handlers, any sinks, and tap observers
import type {EventHandler, EventSink, TapHandler, PipedMessage} from 'strongbus';
```

`MultiEventHandler` maps to `EventSink` (the `(event, payload)` handler used by
`any`). `WildcardEventHandler` maps to `TapHandler`, which receives a single
correlated `{event, payload}` `PipedMessage` (`tap((message) => …)`). A
single-event handler that was typed via `EventHandler<Map, 'foo'>` in v2 is still
`EventHandler<Map, 'foo'>` in v3.

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

// v3 (scope / includeIncognito are optional)
if (bus.hasListenersFor('foo')) { /* ... */ }
const count = bus.getListenerCountFor('foo');
const handlers = bus.getListenersFor('foo');
bus.forEach((event, set) => { /* ... */ });
bus.forEach((event, set) => { /* ... */ }, {scope: ListenerScope.OWN});
bus.forEach((event, set) => { /* ... */ }, {scope: ListenerScope.DOWNSTREAM});
bus.hasListeners({includeIncognito: true});
```
