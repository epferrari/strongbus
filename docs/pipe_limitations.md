# Multi-hop pipe / forward limitations

Strongbus type-checks each `pipe` / `forward` hop **pairwise**: shared event keys
must have compatible payloads between that hop’s source map and destination map.
Target-only keys on the destination are allowed (the typed source never raises
them). Source-only keys are dropped from the destination’s *typed* surface.

That model is sound for a **single** hop. It is **not** sound for multi-hop
graphs, because at runtime every hop forwards events blindly — including keys
the middle bus never declared in its `EventMap`.

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
// Runtime: a → b → c delivers 42 to a string handler.
// Handler errors are reported on Lifecycle.error (emit does not rethrow).
```

The same laundering works if the first hop is `forward` instead of `pipe(bus)`:

```typescript
a.pipe((_msg, forward) => forward(b));
b.pipe(c);
a.emit('bar', 42); // still reaches c
```

`forward` only constrains its immediate target against the sink’s bus map. It
does not know about that target’s own outbound pipes or forwards.

## Why the type system cannot close it

1. `a.pipe(b)` returns `b`, so the next `pipe` / `forward` only sees `b`’s map.
2. Separate statements (`a.pipe(b); b.pipe(c)`) have no typed edge from `a` to `c`.
3. `EventMap` is erased at runtime — an intermediate bus cannot know which keys
   it was “supposed” to declare without a separate runtime catalog.

## What Strongbus does instead

### Setup warning

When a bus becomes both:

- a **target** of `pipe` / `forward` (inbound), and
- a **source** of `pipe(bus)` or a passthrough `forward` (outbound),

…and that bus has **no** `passthroughFilter`, Strongbus logs a **one-time warning**
naming the vulnerable bus and pointing here.

One-hop graphs (`a.pipe(b)` with no further outbound from `b`) do not warn.

### `options.passthroughFilter`

Put the filter on the **middle** (bridge) bus — the one that both receives from
upstream and sends downstream:

```typescript
const b = new Bus<{foo: string}>({
  passthroughFilter: (event, _payload) => event === 'foo'
});

a.pipe(b).pipe(c);
a.emit('foo', 'ok');  // relayed
a.emit('bar', 42);    // dropped at b; never reaches c
```

The filter runs only when **this** bus is dispatching an event it received via
`pipe` / `forward` (passthrough), immediately before:

- propagating to `pipe(bus)` downstreams, or
- invoking `forward(dest)` from a sink on this bus

Return `true` to allow the event through; `false` to drop it. Own listeners on
the bridge still run regardless of the filter.

If you omit the filter, passthrough events are still delivered (backward
compatible); you only get the setup warning.

## Practical guidance

| Pattern | Safe without filter? |
| --- | --- |
| Single hop `a.pipe(b)` / `forward(b)` | Yes (pairwise types apply) |
| Linear chain where every hop uses the **same** map | Yes in practice |
| Narrow middle bus between wider/disagreeing maps | **No** — use `passthroughFilter` or don’t bridge |
| Many feeders `forward` into one hub (hub has no outbound pipe) | Yes — hub is not a bridge |

Prefer keeping bridges on a single shared `EventMap`, or filter explicitly on the
bridge when maps differ.
