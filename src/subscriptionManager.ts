import {type Subscription, type EventMap, WILDCARD} from './types/events';
import type {EventSink, TapHandler, PipedMessage, GenericHandler} from './types/eventHandlers';
import type {MaterializedBusOptions} from './types/materializedBusOptions';
import type {SubscribeOptions} from './types/surfaces/subscriptionSurface';
import type {EventKeys} from './types/utility';
import type {LifecycleManager} from './lifecycleManager';
import {type StrongbusLogger} from './strongbusLogger';
import {EMPTY_MAP} from './utils/emptyCollections';
import {over} from './utils/over';
import {unnamed} from './utils/unnamed';

/**
 * Bus identity / callbacks {@link SubscriptionManager} needs.
 * Shared resources (`options`, `logger`, `lifecycle`) are constructor deps.
 * @internal
 */
export interface SubscriptionHost {
  invalidateOwnListenerCache(): void;
  invalidateListenerCachesUpstream(): void;
}

type ListenerKey = string | number | symbol;
type RegistrationKind = 'on' | 'once' | 'any' | 'tap';

/** What a registration holds until its first frame, so most registrations never grow an array by `push` */
const NO_FRAMES: Subscription[] = Object.freeze([]) as unknown as Subscription[];

/**
 * One distinct subscription: what kind it is, the handler the caller passed, and the event it
 * listens to. Subscribing the same thing again adds a frame to the registration instead of
 * creating another one; the duplicate strategy decides what the frames mean.
 */
class Registration {
  /** One live {@link Subscription} per subscribe call */
  public frames: Subscription[] = NO_FRAMES;
  public invokeCount = 1;
  public observabilityCount = 1;
  /** What the bus keeps in its per-event handler sets: `handler` for `on`, a wrapper for `once` and `tap`. Unused by `any`. */
  public emitHandler: GenericHandler;
  /** The caller's other registrations of the same handler */
  public next: Registration | undefined;

  public readonly kind: RegistrationKind;
  public readonly handler: GenericHandler;
  /** The event; for {@link AnyRegistration}, its canonical events joined into one string */
  public readonly key: ListenerKey;
  public readonly incognito: boolean;

  constructor(kind: RegistrationKind, handler: GenericHandler, key: ListenerKey, incognito: boolean) {
    this.kind = kind;
    this.handler = handler;
    this.key = key;
    this.incognito = incognito;
    this.emitHandler = handler;
  }

  /** Whether `strategy.disposal` applies; a `once` is always released on its own */
  public get honorsDisposalStrategy(): boolean {
    return this.kind !== 'once';
  }
}

/** An `any` listens to several events with one handler, through one wrapper per event */
class AnyRegistration extends Registration {
  public wrappers: GenericHandler[] = [];
  public readonly events: ListenerKey[];

  constructor(handler: GenericHandler, key: string, incognito: boolean, events: ListenerKey[]) {
    super('any', handler, key, incognito);
    this.events = events;
  }
}

/** Registrations a handler may have before they are looked up by key instead of searched in turn */
const MAX_CHAINED_REGISTRATIONS = 16;

/**
 * The registrations of a handler that is subscribed to many events, found by event rather than by
 * walking a chain. A key holds at most one registration per kind. Iterates in the order the
 * registrations were made.
 */
class RegistrationIndex {
  private readonly all = new Set<Registration>();
  private readonly byKey = new Map<ListenerKey, Registration[]>();

  public find(kind: RegistrationKind, key: ListenerKey): Registration | undefined {
    return this.byKey.get(key)?.find(r => r.kind === kind);
  }

  public add(registration: Registration): void {
    this.all.add(registration);
    const sameKey = this.byKey.get(registration.key);
    if(sameKey) {
      sameKey.push(registration);
    } else {
      this.byKey.set(registration.key, [registration]);
    }
  }

  public delete(registration: Registration): void {
    this.all.delete(registration);
    const sameKey = this.byKey.get(registration.key);
    if(!sameKey) {
      return;
    }
    const index = sameKey.indexOf(registration);
    if(index === -1) {
      return;
    }
    sameKey.splice(index, 1);
    if(sameKey.length === 0) {
      this.byKey.delete(registration.key);
    }
  }

  public get isEmpty(): boolean {
    return this.all.size === 0;
  }

  public [Symbol.iterator](): IterableIterator<Registration> {
    return this.all.values();
  }
}

/** The (event, handler) pairs that are incognito. Never mutated while it is {@link NO_INCOGNITO}. */
class IncognitoIndex {
  public total = 0;
  private readonly handlersByEvent = new Map<ListenerKey, Set<GenericHandler>>();

  public has(event: ListenerKey, handler: GenericHandler): boolean {
    return this.handlersByEvent.get(event)?.has(handler) ?? false;
  }

  public countFor(event: ListenerKey): number {
    return this.handlersByEvent.get(event)?.size ?? 0;
  }

  public add(event: ListenerKey, handler: GenericHandler): void {
    let handlers = this.handlersByEvent.get(event);
    if(!handlers) {
      handlers = new Set();
      this.handlersByEvent.set(event, handlers);
    }
    if(!handlers.has(handler)) {
      handlers.add(handler);
      this.total += 1;
    }
  }

  public delete(event: ListenerKey, handler: GenericHandler): void {
    const handlers = this.handlersByEvent.get(event);
    if(handlers?.delete(handler)) {
      this.total -= 1;
      if(handlers.size === 0) {
        this.handlersByEvent.delete(event);
      }
    }
  }
}

/** Listeners beyond the first that a stacking duplicate strategy counts. Never mutated while it is {@link NO_SURPLUS}. */
class StackedSurplus {
  public sum = 0;
  private readonly byEvent = new Map<ListenerKey, number>();

  public get(event: ListenerKey): number {
    return this.byEvent.get(event) ?? 0;
  }

  public adjust(event: ListenerKey, delta: number): void {
    const current = this.get(event);
    const next = Math.max(current + delta, 0);
    this.sum += next - current;
    if(next === 0) {
      this.byEvent.delete(event);
    } else {
      this.byEvent.set(event, next);
    }
  }
}

const NO_INCOGNITO = new IncognitoIndex();
const NO_SURPLUS = new StackedSurplus();

/**
 * Owns the registrations, the handlers an event is delivered to, and the duplicate-subscription
 * stacks. Subscriptions released while another release is running wait for it to finish.
 * @internal
 */
export class SubscriptionManager<TEventMap extends EventMap> {

  /**
   * Every registration, found by the handler the caller passed: the first of a chain linked by
   * {@link Registration.next}, or a {@link RegistrationIndex} once the handler has many
   */
  private registrations = EMPTY_MAP as Map<GenericHandler, Registration | RegistrationIndex>;
  private handlersByEvent = EMPTY_MAP as Map<EventKeys<TEventMap>|WILDCARD, Set<GenericHandler>>;
  /**
   * Number of (event, handler) pairs in `handlersByEvent`, kept in step with it so the lifecycle
   * checks on every add and remove stay O(1) instead of rebuilding the full listener map each time.
   */
  private handlerTotal = 0;
  private incognito = NO_INCOGNITO;
  private surplus = NO_SURPLUS;
  /** Handler sets an emit is iterating right now; adding to one of these must not be seen by that emit */
  private readonly setsBeingIterated: Set<GenericHandler>[] = [];
  private releasing = false;
  /** Releases requested while one is running; created the first time that happens */
  private deferredReleases: {registration: Registration; subscription: Subscription}[] | undefined;

  private readonly host: SubscriptionHost;
  private readonly options: Pick<MaterializedBusOptions, 'duplicateSubscriptionStrategy'>;
  private readonly logger: StrongbusLogger<TEventMap>;
  private readonly lifecycle: LifecycleManager<TEventMap>;

  constructor(params: {
    host: SubscriptionHost;
    options: Pick<MaterializedBusOptions, 'duplicateSubscriptionStrategy'>;
    logger: StrongbusLogger<TEventMap>;
    lifecycle: LifecycleManager<TEventMap>;
  }) {
    this.host = params.host;
    this.options = params.options;
    this.logger = params.logger;
    this.lifecycle = params.lifecycle;
  }

  public off(event: EventKeys<TEventMap>|WILDCARD, handler: GenericHandler): void {
    const registration = this.find('on', handler, event);
    if(!registration?.frames.length) {
      return;
    }
    if(this.options.duplicateSubscriptionStrategy.disposal === 'collapse') {
      for(const frame of registration.frames.slice()) {
        frame();
      }
    } else {
      registration.frames[0]();
    }
  }

  public handlersByEventEntries(): IterableIterator<[EventKeys<TEventMap>|WILDCARD, ReadonlySet<GenericHandler>]> {
    return this.handlersByEvent.entries();
  }

  public handlersFor(event: EventKeys<TEventMap>|WILDCARD): ReadonlySet<GenericHandler>|undefined {
    return this.handlersByEvent.get(event);
  }

  /** Extra listeners a stacking duplicate strategy adds to `event` beyond its distinct handlers */
  public stackedSurplusFor(event: EventKeys<TEventMap>|WILDCARD): number {
    return this.surplus.get(event);
  }

  public stackedSurplusTotal(): number {
    return this.surplus.sum;
  }

  /** Distinct handlers registered for `event` on this bus, optionally excluding incognito ones */
  public ownHandlerCountFor(event: EventKeys<TEventMap>|WILDCARD, includeIncognito: boolean): number {
    const size = this.handlersByEvent.get(event)?.size ?? 0;
    return includeIncognito ? size : size - this.incognito.countFor(event);
  }

  /** Distinct (event, handler) registrations on this bus, optionally excluding incognito ones */
  public ownHandlerTotal(includeIncognito: boolean): number {
    return includeIncognito ? this.handlerTotal : this.handlerTotal - this.incognito.total;
  }

  /**
   * @param includeIncognito - when `false`, incognito registrations are left in place
   */
  public releaseAll(includeIncognito: boolean = true): void {
    const pending: Subscription[] = [];
    for(const kind of ['on', 'once', 'any', 'tap'] as const) {
      for(const entry of this.registrations.values()) {
        for(const r of registrationsOf(entry)) {
          if(r.kind === kind && (includeIncognito || !r.incognito)) {
            pending.push(...r.frames);
          }
        }
      }
    }
    over(pending)();
    if(!includeIncognito) {
      return;
    }
    this.handlersByEvent = EMPTY_MAP;
    this.registrations = EMPTY_MAP;
    this.handlerTotal = 0;
    this.incognito = NO_INCOGNITO;
    this.surplus = NO_SURPLUS;
  }

  public on(
    event: EventKeys<TEventMap>|WILDCARD,
    handler: GenericHandler,
    options?: SubscribeOptions
  ): Subscription {
    return this.subscribeToEvent('on', event, handler, options);
  }

  public once(
    event: EventKeys<TEventMap>|WILDCARD,
    handler: GenericHandler,
    options?: SubscribeOptions
  ): Subscription {
    return this.subscribeToEvent('once', event, handler, options);
  }

  /** Observe every event as a `{event, payload}` message; an `any` on every event would not see future ones */
  public tap(
    handler: TapHandler<TEventMap>,
    options?: SubscribeOptions
  ): Subscription {
    return this.subscribeToEvent('tap', WILDCARD, handler as GenericHandler, options);
  }

  public any(
    events: EventKeys<TEventMap>[],
    handler: EventSink<TEventMap>,
    options?: SubscribeOptions
  ): Subscription {
    const uniqueEvents = canonicalizeEventKeys(events);
    const eventsKey = uniqueEvents.map(String).join('\0');
    const existing = this.find('any', handler as GenericHandler, eventsKey);
    if(existing) {
      return this.subscribeAgain(existing, uniqueEvents.map(String).join(','));
    }

    const registration = new AnyRegistration(
      handler as GenericHandler,
      eventsKey,
      options?.incognito === true,
      uniqueEvents
    );
    for(const e of uniqueEvents) {
      const wrapper = unnamed(((payload: any) => {
        const times = Math.max(registration.invokeCount, 1);
        for(let i = 0; i < times; i++) {
          (handler as EventSink<TEventMap>)(e as any, payload);
        }
      }) as GenericHandler);
      registration.wrappers.push(wrapper);
      this.attachEmitHandler(e, wrapper, registration.incognito);
    }
    this.index(registration);
    return this.addFrame(registration);
  }

  private subscribeToEvent(
    kind: 'on' | 'once' | 'tap',
    event: EventKeys<TEventMap>|WILDCARD,
    handler: GenericHandler,
    options?: SubscribeOptions
  ): Subscription {
    const existing = this.find(kind, handler, event);
    if(existing) {
      return this.subscribeAgain(existing, String(event));
    }

    const registration = new Registration(kind, handler, event, options?.incognito === true);
    if(kind === 'once') {
      registration.emitHandler = (payload: any) => this.fireOnce(registration, payload);
    } else if(kind === 'tap') {
      registration.emitHandler = (e: any, payload: any) => this.fireTap(registration, e, payload);
    }
    this.index(registration);
    this.attachEmitHandler(event, registration.emitHandler, registration.incognito);
    return this.addFrame(registration);
  }

  /** Handles a subscribe call for something already registered, as the duplicate strategy says */
  private subscribeAgain(registration: Registration, label: string): Subscription {
    const strategy = this.options.duplicateSubscriptionStrategy;
    this.logger.onDuplicateSubscription(registration.kind, label, strategy.logLevel);
    if(registration.honorsDisposalStrategy && strategy.disposal === 'collapse') {
      if(strategy.invocation === 'stack') {
        registration.invokeCount += 1;
      }
      if(strategy.observability === 'stack') {
        registration.observabilityCount += 1;
        this.adjustObservability(registration, 1);
      }
      return registration.frames[0];
    }
    return this.addFrame(registration);
  }

  private addFrame(registration: Registration): Subscription {
    const strategy = this.options.duplicateSubscriptionStrategy;
    if(registration.frames.length > 0) {
      if(strategy.invocation === 'stack') {
        registration.invokeCount += 1;
      }
      if(strategy.observability === 'stack') {
        registration.observabilityCount += 1;
        this.adjustObservability(registration, 1);
      }
    }
    const subscription: Subscription = unnamed(() => this.release(registration, subscription)) as Subscription;
    subscription.unsubscribe = subscription;
    if(registration.frames === NO_FRAMES) {
      registration.frames = [subscription];
    } else {
      registration.frames.push(subscription);
    }
    return subscription;
  }

  private release(registration: Registration, subscription: Subscription): void {
    if(this.releasing) {
      (this.deferredReleases ??= []).push({registration, subscription});
      return;
    }
    this.releasing = true;
    try {
      this.disposeFrame(registration, subscription);
      for(let next = this.deferredReleases?.shift(); next; next = this.deferredReleases?.shift()) {
        this.disposeFrame(next.registration, next.subscription);
      }
    } finally {
      this.releasing = false;
    }
  }

  private disposeFrame(registration: Registration, subscription: Subscription): void {
    const idx = registration.frames.indexOf(subscription);
    if(idx === -1) {
      return;
    }
    const strategy = this.options.duplicateSubscriptionStrategy;
    const collapse = registration.honorsDisposalStrategy && strategy.disposal === 'collapse';

    if(collapse) {
      const observed = registration.observabilityCount;
      registration.frames.length = 0;
      registration.invokeCount = 0;
      registration.observabilityCount = 0;
      for(let i = 0; i < observed - 1; i++) {
        this.adjustObservability(registration, -1);
      }
      this.releaseRegistration(registration);
      return;
    }

    registration.frames.splice(idx, 1);
    if(strategy.invocation === 'stack' && registration.invokeCount > 0) {
      registration.invokeCount -= 1;
    }

    if(strategy.observability === 'stack' && registration.observabilityCount > 1) {
      registration.observabilityCount -= 1;
      this.adjustObservability(registration, -1);
    } else if(strategy.observability === 'stack') {
      registration.observabilityCount = 0;
    }

    if(registration.frames.length === 0) {
      this.releaseRegistration(registration);
    }
  }

  /** Stops delivering to a registration whose last frame is gone */
  private releaseRegistration(registration: Registration): void {
    const events = this.eventsOf(registration);
    if(!registration.incognito) {
      for(const e of events) {
        this.lifecycle.ownListenerWillRemove(e as EventKeys<TEventMap>);
      }
    }
    if(registration instanceof AnyRegistration) {
      registration.events.forEach((e, i) => {
        this.detachEmitHandler(e as EventKeys<TEventMap>, registration.wrappers[i]);
      });
    } else {
      this.detachEmitHandler(registration.key as EventKeys<TEventMap>, registration.emitHandler);
    }
    this.unindex(registration);
    if(!registration.incognito) {
      for(const e of events) {
        this.lifecycle.ownListenerDidRemove(e as EventKeys<TEventMap>);
      }
    }
  }

  /** Reports the listener a stacked duplicate added or removed to the lifecycle, without changing the handler sets */
  private adjustObservability(registration: Registration, delta: number): void {
    const incognito = registration.incognito;
    for(const e of this.eventsOf(registration)) {
      if(incognito) {
        continue;
      }
      this.adjustSurplus(e, delta);
      if(delta > 0) {
        this.lifecycle.ownListenerWillAdd(e as EventKeys<TEventMap>);
        this.lifecycle.ownListenerDidAdd(e as EventKeys<TEventMap>);
      } else if(delta < 0) {
        this.lifecycle.ownListenerWillRemove(e as EventKeys<TEventMap>);
        this.lifecycle.ownListenerDidRemove(e as EventKeys<TEventMap>);
      }
    }
  }

  private adjustSurplus(event: ListenerKey, delta: number): void {
    if(delta > 0 && this.surplus === NO_SURPLUS) {
      this.surplus = new StackedSurplus();
    }
    this.surplus.adjust(event, delta);
    if(this.surplus.sum === 0) {
      this.surplus = NO_SURPLUS;
    }
  }

  private eventsOf(registration: Registration): ListenerKey[] {
    return registration instanceof AnyRegistration ? registration.events : [registration.key];
  }

  private fireOnce(registration: Registration, payload: any): void {
    if(!registration.frames.length) {
      return;
    }
    const times = Math.max(registration.invokeCount, 1);
    for(const frame of registration.frames.slice()) {
      frame();
    }
    for(let i = 0; i < times; i++) {
      registration.handler(payload);
    }
  }

  private fireTap(registration: Registration, event: any, payload: any): void {
    const times = Math.max(registration.invokeCount, 1);
    for(let i = 0; i < times; i++) {
      (registration.handler as TapHandler<TEventMap>)({event, payload} as PipedMessage<TEventMap>);
    }
  }

  private find(kind: RegistrationKind, handler: GenericHandler, key: ListenerKey): Registration | undefined {
    const entry = this.registrations.get(handler);
    if(entry instanceof RegistrationIndex) {
      return entry.find(kind, key);
    }
    for(let r = entry; r; r = r.next) {
      if(r.kind === kind && r.key === key) {
        return r;
      }
    }
    return undefined;
  }

  /** Added after the handler's existing registrations, so they are released in the order they were made */
  private index(registration: Registration): void {
    const entry = this.registrations.get(registration.handler);
    if(!entry) {
      if(this.registrations === EMPTY_MAP) {
        this.registrations = new Map();
      }
      this.registrations.set(registration.handler, registration);
    } else if(entry instanceof RegistrationIndex) {
      entry.add(registration);
    } else {
      this.chain(entry, registration);
    }
  }

  private chain(head: Registration, registration: Registration): void {
    let tail = head;
    let length = 1;
    while(tail.next) {
      tail = tail.next;
      length += 1;
    }
    if(length < MAX_CHAINED_REGISTRATIONS) {
      tail.next = registration;
      return;
    }
    const index = new RegistrationIndex();
    for(let r: Registration | undefined = head; r;) {
      const following = r.next;
      r.next = undefined;
      index.add(r);
      r = following;
    }
    index.add(registration);
    this.registrations.set(registration.handler, index);
  }

  private unindex(registration: Registration): void {
    const entry = this.registrations.get(registration.handler);
    if(entry instanceof RegistrationIndex) {
      entry.delete(registration);
      if(entry.isEmpty) {
        this.registrations.delete(registration.handler);
      }
    } else if(entry === registration) {
      if(registration.next) {
        this.registrations.set(registration.handler, registration.next);
      } else {
        this.registrations.delete(registration.handler);
      }
    } else {
      let previous = entry;
      while(previous && previous.next !== registration) {
        previous = previous.next;
      }
      if(previous) {
        previous.next = registration.next;
      }
    }
    registration.next = undefined;
  }

  private attachEmitHandler(
    event: EventKeys<TEventMap>|WILDCARD,
    handler: GenericHandler,
    incognito: boolean
  ): void {
    if(!incognito) {
      this.lifecycle.ownListenerWillAdd(event);
    }
    const prev = this.handlersByEvent.get(event);
    let next = prev;
    if(!next) {
      next = new Set<GenericHandler>();
      if(this.handlersByEvent === EMPTY_MAP) {
        this.handlersByEvent = new Map();
      }
      this.handlersByEvent.set(event, next);
    } else if(this.setsBeingIterated.includes(next)) {
      next = new Set<GenericHandler>(prev);
      this.handlersByEvent.set(event, next);
    }
    const added = !next.has(handler);
    next.add(handler);
    if(added) {
      this.handlerTotal += 1;
    }
    if(incognito) {
      if(this.incognito === NO_INCOGNITO) {
        this.incognito = new IncognitoIndex();
      }
      this.incognito.add(event, handler);
    }
    this.host.invalidateListenerCachesUpstream();
    this.host.invalidateOwnListenerCache();
    if(!incognito) {
      this.lifecycle.ownListenerDidAdd(event);
    }
    if(added) {
      this.logger.onAddListener(event, this.ownListenerCountForEvent(event));
    }
  }

  private detachEmitHandler(
    event: EventKeys<TEventMap>|WILDCARD,
    handler: GenericHandler
  ): void {
    const set = this.handlersByEvent.get(event);
    if(!set?.size) {
      return;
    }
    const removed = set.delete(handler);
    if(removed) {
      this.handlerTotal -= 1;
      this.incognito.delete(event, handler);
      if(set.size === 0) {
        this.handlersByEvent.delete(event);
      }
      this.host.invalidateListenerCachesUpstream();
      this.host.invalidateOwnListenerCache();
      this.logger.onListenerRemoved(event, this.ownListenerCountForEvent(event));
    }
  }

  /** Distinct handlers for `event`, plus the extra listeners stacked duplicates add */
  public ownListenerCountForEvent(event: EventKeys<TEventMap>|WILDCARD): number {
    return (this.handlersByEvent.get(event)?.size ?? 0) + this.surplus.get(event);
  }

  public isIncognito(
    handler: GenericHandler,
    event: EventKeys<TEventMap>|WILDCARD
  ): boolean {
    return this.incognito.has(event, handler);
  }

  public consumeEvent(event: EventKeys<TEventMap>|WILDCARD, ...args: any[]): boolean {
    const handlers = this.handlersByEvent.get(event);
    if(handlers && handlers.size) {
      this.setsBeingIterated.push(handlers);
      try {
        for(const fn of handlers) {
          const times = this.invokeTimesFor(event, fn);
          for(let i = 0; i < times; i++) {
            try {
              const execution = fn(...args);
              (execution as Promise<any>)?.catch?.((e) => {
                this.lifecycle.reportHandlerError(e, event);
              });
            } catch(e: unknown) {
              this.lifecycle.reportHandlerError(e, event);
            }
          }
        }
      } finally {
        this.setsBeingIterated.pop();
      }
      return true;
    }
    return false;
  }

  /** How often a stacking `invocation` strategy delivers one event to an `on` handler */
  private invokeTimesFor(event: EventKeys<TEventMap>|WILDCARD, emitHandler: GenericHandler): number {
    if(this.options.duplicateSubscriptionStrategy.invocation !== 'stack') {
      return 1;
    }
    const registration = this.find('on', emitHandler, event);
    return registration ? Math.max(registration.invokeCount, 1) : 1;
  }
}

function* registrationsOf(entry: Registration | RegistrationIndex): IterableIterator<Registration> {
  if(entry instanceof RegistrationIndex) {
    yield* entry;
    return;
  }
  for(let r: Registration | undefined = entry; r; r = r.next) {
    yield r;
  }
}

function canonicalizeEventKeys<T extends string | number | symbol>(events: T[]): T[] {
  const seen = new Set<T>();
  const unique: T[] = [];
  for(const e of events) {
    if(!seen.has(e)) {
      seen.add(e);
      unique.push(e);
    }
  }
  return unique.sort((a, b) => String(a).localeCompare(String(b)));
}
