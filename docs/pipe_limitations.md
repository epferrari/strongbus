# Multi-hop pipe limitations

Strongbus type-checks each `pipe` hop **pairwise**: shared event keys must have
compatible payloads between that hop’s source map and destination map.
Target-only keys on the destination are allowed (the typed source never raises
them). Source-only keys are dropped from the destination’s *typed* surface.

That model is sound for a **single** hop. It is **not** sound for unfiltered
multi-hop graphs, because a middle bus can relay keys it never declared in its
`EventMap`.

## The hole

```typescript
const a = new Bus<{foo: string; bar: number}>();
const b = new Bus<{foo: string}>();
const c = new Bus<{foo: string; bar: string}>();

a.pipe(b).pipe(c);
// TypeScript is happy:
//   a→b shares only foo (ok)
//   b→c shares only foo (ok); c's bar is "target-only" from b's map

c.on('bar', (s) => s.toLowerCase());
a.emit('bar', 42);
// Without a call-site filter on b→c, runtime would deliver 42 to a string handler.
// Handler errors are reported on Lifecycle.error (emit does not rethrow).
```

## Why the type system cannot close it

1. `a.pipe(b)` returns `b`, so the next `pipe` only sees `b`’s map.
2. Separate statements (`a.pipe(b); b.pipe(c)`) have no typed edge from `a` to `c`.
3. `EventMap` is erased at runtime — an intermediate bus cannot know which keys
   it was “supposed” to declare without a separate runtime catalog.

## What Strongbus does instead

### Observe without linking: `tap`

```typescript
a.tap(({event, payload}) => {
  // no graph edge, manually re-emit
  if(event === 'foo') {
    b.emit(event, payload);
  }
});
```

### Call-site filter: `pipe(predicate).pipe(dest)`

Put the filter on the **outbound edge** of the bridge bus:

```typescript
a.pipe(b);
b.pipe((msg) => msg.event === 'foo').pipe(c);

a.emit('foo', 'ok'); // relayed through b → c
a.emit('bar', 42);   // dropped on the b→c edge; never reaches c
```

- Local raises / first hop always deliver to `pipe(bus)`
  destinations — the predicate gates **passthrough** only.
- Filter deny → drop quietly.
- Own listeners on the bridge still run regardless of the filter.

### Setup warning + blocked passthrough

When a bus is already a **pipe target** (inbound) and you attach an **unfiltered**
`pipe(dest)` outbound edge, Strongbus:

1. Logs a **one-time warning** naming the vulnerable bus and pointing here.
2. **Blocks passthrough** on that edge (upstream-sourced events are not relayed).
   Local `emit` on the bridge still delivers to the dest.

```typescript
a.pipe(b);
b.pipe(c); // warn once; a→b→c passthrough blocked
b.pipe((msg) => msg.event === 'foo').pipe(c); // allow selected passthrough
```

One-hop graphs (`a.pipe(b)` with no further outbound from `b`) do not warn.

## Practical guidance

| Pattern | Safe? |
| --- | --- |
| Single hop `a.pipe(b)` | Yes (pairwise types apply) |
| Linear chain where every hop uses the **same** map | Yes in practice; filter optional |
| Narrow middle bus between wider/disagreeing maps | Use `b.pipe(predicate).pipe(c)` |
| Many feeders `pipe` into one hub (hub has no outbound pipe) | Yes — hub is not a bridge |

Prefer keeping bridges on a single shared `EventMap`, or filter explicitly on the
bridge edge when maps differ.
