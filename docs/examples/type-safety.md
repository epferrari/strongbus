# Type safety

Strongbus checks every subscribe, emit, and pipe call against your `EventMap`.
Illegal combinations are **compile errors** — not runtime surprises.

This guide shows what TypeScript accepts and rejects for the three call sites you
use most. The repo’s exhaustive suite lives in
[`src/typeSafety_spec.ts`](../../src/typeSafety_spec.ts) (`// @ts-expect-error`
lines fail the build if they ever become valid).

```typescript
import {Bus} from 'strongbus';

interface Events {
  message: string;
  count: number;
  connected: void;
}

const bus = new Bus<Events>();
```

---

## Subscribe

### `on` / `once`

**Allowed** — known event keys; handler payload matches the map.

```typescript
bus.on('message', (payload) => {
  // payload: string
  payload.toUpperCase();
});

bus.once('count', (n) => {
  // n: number
  n.toFixed(2);
});

bus.on('connected', () => {
  // void payload — no useful value
});
```

**Compile error**

```typescript
// unknown event
bus.on('mesage', () => {});

// wrong payload type in the handler
bus.on('count', (n: string) => {});

// wildcard is reserved (use tap for “all events”)
bus.on('*', () => {});
```

### `any`

**Allowed** — a subset of known keys. The handler is an `EventSink`:
`(event, payload)`. Discriminate on `event` to narrow `payload`.

```typescript
bus.any(['message', 'count'], (event, payload) => {
  if (event === 'message') {
    // payload: string
  } else {
    // payload: number
  }
});
```

**Compile error**

```typescript
bus.any(['message', 'unknown'], () => {});
bus.any(['*'], () => {});
```

### `off`

Same key and handler-shape rules as `on`. Pass the **same function reference**
you registered with `on`.

```typescript
const handle = (payload: string) => { /* ... */ };
bus.on('message', handle);
bus.off('message', handle);

bus.off('nope', handle);           // unknown event
bus.off('message', (n: number) => {}); // wrong payload type
```

---

## Emit

**Allowed** — correlated `(event, payload)`. Void events may omit the payload
(or pass `null` / `undefined`).

```typescript
bus.emit('message', 'hello');
bus.emit('count', 42);
bus.emit('connected');
bus.emit('connected', null);
```

**Compile error**

```typescript
bus.emit('message');              // string payload required
bus.emit('count', 'forty-two');   // wrong payload type
bus.emit('connected', 'x');       // void event cannot take a real payload
bus.emit('unknown', 1);           // unknown event
bus.emit('*', undefined);         // wildcard is reserved
```

`emit` never accepts a `{event, payload}` object. That keeps you from
re-emitting an uncorrelated pair after a multi-event subscribe.

```typescript
bus.any(['message', 'count'], (event, payload) => {
  // rejected: event and payload are a union pair, not one correlated emit
  bus.emit(event, payload);

  // ok after discriminating
  if (event === 'message') {
    bus.emit(event, payload);
  }
});
```

---

## Pipe

### Observe — `tap(handler)`

The handler receives one correlated `{event, payload}` message. Narrow by
discriminating on `message.event`. Does not create a graph edge.

**Allowed**

```typescript
bus.tap((message) => {
  // message.payload is string | number | void until you narrow
  if (message.event === 'message') {
    message.payload.toUpperCase(); // string
  } else if (message.event === 'count') {
    message.payload.toFixed(0);    // number
  }
});
```

**Compile error**

```typescript
bus.tap((message) => {
  // cannot call string methods on the full payload union
  message.payload.toUpperCase();
});

// handler typed for a disjoint event map
bus.tap((message: {event: 'other'; payload: boolean}) => {});
```

### Filtered multi-hop — `pipe(pred).pipe(dest)`

When a bus is both a pipe target and a pipe source, allow passthrough with an
explicit predicate on the outbound edge (see [`docs/pipe_limitations.md`](../pipe_limitations.md)):

```typescript
const mid = new Bus<{message: string}>();
const leaf = new Bus<Events>();

bus.pipe(mid);
mid.pipe((msg) => msg.event === 'message').pipe(leaf);
```

### Bus downstream — `pipe(bus)`

Shared events must be payload-compatible: identical types, or a **one-way widen**
in the same primitive family (`'a'|'b' → string`, `true → boolean`, `1|2 → number`).
Object payloads still require an exact match. Returns the **downstream** bus (for
chaining). Requires a real `Bus` instance — not a hand-rolled surface.

**Allowed**

```typescript
const leaf = new Bus<{message: string; count: number}>();
const root = new Bus<Events>();

root.pipe(leaf); // shared keys agree; 'connected' is root-only (dropped)

const narrow = new Bus<{message: string}>();
const downstream = root.pipe(narrow);
// downstream is Bus<{message: string}>
downstream.on('message', (s) => s.toUpperCase());
```

**Compile error**

```typescript
root.pipe(new Bus<{message: number}>()); // payload conflict on 'message'

root.pipe({
  on() { /* ... */ },
  emit() { return false; }
}); // not a Bus instance
```

Piping a **wider** source into a **narrower** destination is fine: extra source
events are not part of the downstream’s typed surface (they may still arrive at
runtime if you somehow listen outside the type system; typed `on`/`pipe` on the
narrow bus cannot name them).

```typescript
const wide = new Bus<{foo: string; bar: string; baz: number}>();
const narrow = new Bus<{foo: string; bar: string}>();
const d = wide.pipe(narrow);

d.on('foo', (s) => s.toUpperCase());
d.on('baz', () => {}); // 'baz' is not on Narrow
```

---

## Quick cheat sheet

| Call | Must be | Must not |
| --- | --- | --- |
| `on` / `once` / `off` | Key in the map; matching handler payload | Unknown key, `'*'`, wrong payload type |
| `any` | Array of known keys | Unknown key, `'*'` |
| `emit` | Correlated `(event, payload)` | Missing/wrong payload, `'*'`, `{event, payload}` object, uncorrelated union pair |
| `tap` | Handler for this map (or compatible overlap) | Disjoint handler map; using payload before discriminating |
| `pipe(bus)` / `pipe(pred).pipe(bus)` | `Bus` whose shared events are compatible | Payload conflict; unsafe narrow; non-`Bus` duck type |

For variance (`Bus<Wide>` as `SubscriptionSurface<Narrow>`), generics, `next` /
`scan` triggers, and lifecycle hooks, see
[`src/typeSafety_spec.ts`](../../src/typeSafety_spec.ts).
