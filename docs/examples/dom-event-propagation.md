# Mapping Strongbus `pipe`s onto a familiar mental model - DOM Event propagation

DOM event propagation — **capture → target → bubble** along an ancestor path —
is a familiar mental model for directed, multi-hop delivery. Strongbus `pipe`
edges map onto that model cleanly: each phase is its own bus graph and pipe
direction.

This is an analogy for how pipes compose, not a recipe for reimplementing
`EventTarget`. For multi-hop filtering rules, see
[pipe limitations](../pipe_limitations.md).

---

## DOM phases ↔ pipe directions

| DOM phase | Direction | Strongbus edge |
| --- | --- | --- |
| Capture | root → … → target | `parent.captureBus.pipe(…).pipe(child.captureBus)` |
| Target | at the dispatch node | own listeners on that phase’s bus |
| Bubble | target → … → root | `child.bubbleBus.pipe(…).pipe(parent.bubbleBus)` |

Delivery on each bus is: **own listeners first**, then **propagate** to
downstream pipes — “handle this node, then continue along the phase’s edges.”

`pipe` is one-way. Two phases therefore mean **two buses per node** and two
acyclic graphs — not bidirectional pipes on a single bus (which would be a
cycle, broken only by payload filters).

---

## A tree of buses

Each node owns a **capture** bus and a **bubble** bus. `append` wires capture
down and bubble up as separate graphs.

```typescript
import {
  Bus,
  type EventHandler,
  type PipedMessage,
  type SubscribableEventKeys,
} from 'strongbus';

type Phase = 'capture' | 'bubble';

/** Sketch subset of DOM `Event` — enough for path gating and stopPropagation. */
interface Event {
  /** Node where `dispatchEvent` was called. */
  readonly target: DomNode;
  /** Observational; roughly `Event.eventPhase`. Not used for pipe routing. */
  phase: Phase;
  /** When true, pipe predicates drop further hops. */
  stopped: boolean;
}

interface DomEvents {
  click: Event;
  // ... and so forth
}

/**
 * `EventTarget` listener shapes, keyed like {@link Bus.on}:
 * `EventHandler` for the function form, same payload for `handleEvent`.
 */
type DomListener<T extends SubscribableEventKeys<DomEvents>> =
  | EventHandler<DomEvents, T>
  | {handleEvent: EventHandler<DomEvents, T>};

/** Subset of DOM `AddEventListenerOptions` used by this sketch. */
type DomAddEventListenerOptions = {
  capture?: boolean;
  once?: boolean;
};

class DomNode {
  public readonly type: string;
  protected readonly captureBus: Bus<DomEvents>;
  protected readonly bubbleBus: Bus<DomEvents>;
  public parent: DomNode | null = null;
  public readonly children: DomNode[] = [];

  public constructor(type: string) {
    this.type = type;
    this.captureBus = new Bus<DomEvents>({name: `${type}:capture`});
    this.bubbleBus = new Bus<DomEvents>({name: `${type}:bubble`});
  }

  public append(child: DomNode): void {
    child.parent = this;
    this.children.push(child);

    // capture graph: parent → child (acyclic tree downward)
    this.captureBus.pipe(this.captureEdge(child)).pipe(child.captureBus);

    // bubble graph: child → parent (acyclic tree upward)
    child.bubbleBus.pipe(this.bubbleEdge()).pipe(this.bubbleBus);
  }

  public addEventListener<T extends SubscribableEventKeys<DomEvents>>(
    type: T,
    listener: DomListener<T> | null,
    options?: boolean | DomAddEventListenerOptions
  ): void {
    if (listener == null) {
      return;
    }
    const opts = typeof options === 'boolean' ? {capture: options} : options ?? {};
    const bus = opts.capture ? this.captureBus : this.bubbleBus;
    const handler: EventHandler<DomEvents, T> =
      typeof listener === 'function'
        ? listener
        : (event) => listener.handleEvent(event);

    if (opts.once) {
      bus.once(type, handler);
    } else {
      bus.on(type, handler);
    }
    // removeEventListener is omitted: Bus.off needs the same function reference
    // passed to Bus.on, but we subscribe a phase-wrapping `handler`, not
    // `listener`. A real {add,remove}EventListener pair would keep a lookup from
    // (type, listener, capture) → handler (or Subscription) and dispose that.
  }

  public dispatchEvent(): void {
    const event: Event = {
      target: this,
      phase: 'capture',
      stopped: false,
    };

    // capture: root → … → target
    this.root.captureBus.emit('click', event);
    if (event.stopped) return;

    // bubble: target → … → root
    event.phase = 'bubble';
    this.bubbleBus.emit('click', event);
  }

  public get root(): DomNode {
    let node: DomNode = this;
    while (node.parent) node = node.parent;
    return node;
  }

  /** True when this node is `target` or an ancestor of it (reference equality). */
  protected contains(target: DomNode): boolean {
    if (this === target) return true;
    return this.children.some((child) => child.contains(target));
  }

  private captureEdge(child: DomNode) {
    return (msg: PipedMessage<DomEvents>): boolean =>
      !msg.payload.stopped && child.contains(msg.payload.target);
  }

  private bubbleEdge() {
    return (msg: PipedMessage<DomEvents>): boolean => !msg.payload.stopped;
  }
}
```

Capture edges path-gate on `event.target` (a `DomNode` reference) so a branching
tree does not fan out to **siblings**. Bubble edges need no path check: bubbling
starts at the target and follows the unique parent chain. Neither predicate
needs a phase check — the bus identity is the phase.

Every intermediate bus in a phase chain is still a **bridge** (inbound +
outbound pipes). The predicates on those edges are the call-site filters
Strongbus requires for multi-hop passthrough — an unfiltered outbound edge after
an inbound pipe would warn and **block** passthrough
([pipe limitations](../pipe_limitations.md)).

---

## Subscribing and dispatching

`addEventListener` mirrors `EventTarget`’s call shape, but `type` and `listener`
are checked like `Bus.on` — `SubscribableEventKeys<DomEvents>` and
`EventHandler<DomEvents, T>` (or `{handleEvent}` with the same handler type).
The third argument selects which bus receives the subscription (`true` /
`{capture: true}` → `captureBus`, otherwise `bubbleBus`).

```typescript
const document = new DomNode('document');
const body = new DomNode('body');
const div = new DomNode('div');
const button = new DomNode('button');

document.append(body);
body.append(div);
div.append(button);

document.addEventListener('click', (e) => console.log('doc capture', e.target.type), true);
div.addEventListener('click', (e) => console.log('div capture', e.target.type), {capture: true});
button.addEventListener('click', (e) => console.log('button bubble', e.target.type));
document.addEventListener('click', (e) => console.log('doc bubble', e.target.type));

button.dispatchEvent();
```

Order for `button.dispatchEvent()`:

1. `document` capture  
2. `body` capture (if subscribed)  
3. `div` capture  
4. `button` capture (own listeners on `captureBus` during the capture emit)  
5. `button` bubble  
6. `div` bubble  
7. `body` bubble  
8. `document` bubble  

---

## Stopping propagation (analog to native `Event.stopPropagation`)

Pipe predicates drop messages when `stopped` is true. Handlers mutate the
**shared** `Event` that `dispatchEvent` reuses across both phase emits:

```typescript
div.addEventListener('click', (e) => {
  e.stopped = true;
}, true);
```

Further capture hops are dropped by `captureEdge`; `dispatchEvent` skips the
bubble emit when `stopped` is already set. The predicate (and that early return)
are the gate — this sketch’s `Event` is only the fields the pipe graph needs.

---

## Limits of the analogy

| DOM idea | Pipe mapping |
| --- | --- |
| Capture / bubble directions | Separate `captureBus` / `bubbleBus` graphs |
| Ancestor path only | `contains(event.target)` on capture predicates |
| `stopPropagation` | `event.stopped` honored by those predicates |
| `stopImmediatePropagation` | Not part of this sketch |
| `preventDefault` / default actions | Outside the bus graph |
| Mixed capture+bubble listeners on one node | Subscribe on different buses; no cross-phase delivery |
| `removeEventListener` | Needs a `(type, listener, capture) →` wrapped handler / `Subscription` map — `Bus.off` cannot see the original `listener` reference |

---

## Takeaways

1. **`pipe` direction is propagation direction** for that phase’s graph.  
2. **Capture and bubble are two buses (two acyclic graphs)**, not one cyclic bus.  
3. **Capture path-gates** so branching trees do not broadcast to siblings.  
4. **Bridge buses need filtered multi-hop edges** — unfiltered outbound + inbound warns and blocks passthrough.  
5. **Stopping propagation is an `Event` flag** honored by those predicates.
