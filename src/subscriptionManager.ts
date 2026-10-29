import {type Subscription, type EventMap, WILDCARD} from './types/events';
import type {EventSink, TapHandler, PipedMessage, GenericHandler} from './types/eventHandlers';
import type {MaterializedBusOptions} from './types/materializedBusOptions';
import type {SubscribeOptions} from './types/surfaces/subscriptionSurface';
import type {EventKeys} from './types/utility';
import type {LifecycleManager} from './lifecycleManager';
import {type StrongbusLogger} from './strongbusLogger';
import {over} from './utils/over';
import {subscriptionWrapper} from './utils/subscriptionWrapper';

type HandlerIntent = {
  frames: Subscription[];
  invokeCount: number;
  observabilityCount: number;
  /** Handler placed in {@link handlersByEvent} for emit. */
  emitHandler: GenericHandler;
  incognito: boolean;
};

type IntentFrameMeta = {
  honorDisposalConfig: boolean;
  onFullyCleared: () => void;
  adjustStackedObservability: (delta: number) => void;
  fireLifecycleOwnListenerWillRemove: () => void;
  fireLifecycleOwnListenerDidRemove: () => void;
};

/**
 * Bus identity / callbacks {@link SubscriptionManager} needs.
 * Shared resources (`options`, `logger`, `lifecycle`) are constructor deps.
 * @internal
 */
export type SubscriptionHost = {
  invalidateOwnListenerCache(): void;
  invalidateCombinedListenerCache(): void;
};

type AnyIntent<TEventMap extends EventMap> = HandlerIntent & {
  events: EventKeys<TEventMap>[];
  wrappers: Map<EventKeys<TEventMap>, GenericHandler>;
};

/**
 * Per-registration teardown hooks for `on`, `once` and `tap`, as prototype methods so a
 * registration allocates one object instead of one object plus four closures.
 * @internal
 */
class SingleEventFrameMeta<TEventMap extends EventMap> implements IntentFrameMeta {
  public readonly honorDisposalConfig: boolean;
  private readonly manager: SubscriptionManager<TEventMap>;
  private readonly lifecycle: LifecycleManager<TEventMap>;
  private readonly listenableKey: EventKeys<TEventMap>|WILDCARD;
  private readonly incognito: boolean;
  private readonly emitHandler: GenericHandler;
  private readonly intents: Map<GenericHandler, Map<any, HandlerIntent>>;
  private readonly userHandler: GenericHandler;
  private readonly byKey: Map<any, HandlerIntent>;

  constructor(params: {
    manager: SubscriptionManager<TEventMap>;
    lifecycle: LifecycleManager<TEventMap>;
    honorDisposalConfig: boolean;
    listenableKey: EventKeys<TEventMap>|WILDCARD;
    incognito: boolean;
    emitHandler: GenericHandler;
    intents: Map<GenericHandler, Map<any, HandlerIntent>>;
    userHandler: GenericHandler;
    byKey: Map<any, HandlerIntent>;
  }) {
    this.manager = params.manager;
    this.lifecycle = params.lifecycle;
    this.honorDisposalConfig = params.honorDisposalConfig;
    this.listenableKey = params.listenableKey;
    this.incognito = params.incognito;
    this.emitHandler = params.emitHandler;
    this.intents = params.intents;
    this.userHandler = params.userHandler;
    this.byKey = params.byKey;
  }

  public onFullyCleared(): void {
    this.manager.detachEmitHandler(this.listenableKey, this.emitHandler);
    this.byKey.delete(this.listenableKey);
    if(this.byKey.size === 0) {
      this.intents.delete(this.userHandler);
    }
  }

  public adjustStackedObservability(delta: number): void {
    this.manager.adjustSingleStackedObservability(this.listenableKey, this.incognito, delta);
  }

  public fireLifecycleOwnListenerWillRemove(): void {
    if(!this.incognito) {
      this.lifecycle.ownListenerWillRemove(this.listenableKey);
    }
  }

  public fireLifecycleOwnListenerDidRemove(): void {
    if(!this.incognito) {
      this.lifecycle.ownListenerDidRemove(this.listenableKey);
    }
  }
}

/**
 * Per-registration teardown hooks for `any`.
 * @internal
 */
class AnyFrameMeta<TEventMap extends EventMap> implements IntentFrameMeta {
  public readonly honorDisposalConfig: boolean = true;
  private readonly manager: SubscriptionManager<TEventMap>;
  private readonly lifecycle: LifecycleManager<TEventMap>;
  private readonly anyIntents: Map<GenericHandler, Map<string, AnyIntent<TEventMap>>>;
  private readonly intent: AnyIntent<TEventMap>;
  private readonly uniqueEvents: EventKeys<TEventMap>[];
  private readonly intentsForHandler: Map<string, AnyIntent<TEventMap>>;
  private readonly eventsKey: string;
  private readonly handler: GenericHandler;

  constructor(params: {
    manager: SubscriptionManager<TEventMap>;
    lifecycle: LifecycleManager<TEventMap>;
    anyIntents: Map<GenericHandler, Map<string, AnyIntent<TEventMap>>>;
    intent: AnyIntent<TEventMap>;
    uniqueEvents: EventKeys<TEventMap>[];
    intentsForHandler: Map<string, AnyIntent<TEventMap>>;
    eventsKey: string;
    handler: GenericHandler;
  }) {
    this.manager = params.manager;
    this.lifecycle = params.lifecycle;
    this.anyIntents = params.anyIntents;
    this.intent = params.intent;
    this.uniqueEvents = params.uniqueEvents;
    this.intentsForHandler = params.intentsForHandler;
    this.eventsKey = params.eventsKey;
    this.handler = params.handler;
  }

  public onFullyCleared(): void {
    this.manager.teardownAnyEmitHandlers(this.intent);
    this.intentsForHandler.delete(this.eventsKey);
    if(this.intentsForHandler.size === 0) {
      this.anyIntents.delete(this.handler);
    }
  }

  public adjustStackedObservability(delta: number): void {
    this.manager.adjustAnyStackedObservability(this.uniqueEvents, this.intent.incognito, delta);
  }

  public fireLifecycleOwnListenerWillRemove(): void {
    if(this.intent.incognito) {
      return;
    }
    for(const e of this.uniqueEvents) {
      this.lifecycle.ownListenerWillRemove(e);
    }
  }

  public fireLifecycleOwnListenerDidRemove(): void {
    if(this.intent.incognito) {
      return;
    }
    for(const e of this.uniqueEvents) {
      this.lifecycle.ownListenerDidRemove(e);
    }
  }
}

/**
 * Owns duplicate-subscription stacks, emit-handler storage, and unsub queue.
 * @internal
 */
export class SubscriptionManager<TEventMap extends EventMap> {

  private readonly onIntents = new Map<
    GenericHandler,
    Map<EventKeys<TEventMap>|WILDCARD, HandlerIntent>
  >();
  private readonly onceIntents = new Map<
    GenericHandler,
    Map<EventKeys<TEventMap>|WILDCARD, HandlerIntent>
  >();
  private readonly anyIntents = new Map<
    GenericHandler,
    Map<string, HandlerIntent & {
      events: EventKeys<TEventMap>[];
      wrappers: Map<EventKeys<TEventMap>, GenericHandler>;
    }>
  >();
  private readonly tapIntents = new Map<
    GenericHandler,
    Map<typeof WILDCARD, HandlerIntent>
  >();
  private readonly incognitoByHandler = new Map<
    GenericHandler,
    Set<EventKeys<TEventMap>|WILDCARD>
  >();
  private readonly handlersByEvent = new Map<EventKeys<TEventMap>|WILDCARD, Set<GenericHandler>>();
  private readonly stackedListenerSurplusByEvent = new Map<EventKeys<TEventMap>|WILDCARD, number>();
  private readonly unsubQueue: {
    subscription: Subscription;
    dispose: () => void;
  }[] = [];
  private _purgingUnsubQueue: boolean = false;

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
    const intent = this.onIntents.get(handler)?.get(event);
    if(!intent?.frames.length) {
      return;
    }
    const strategy = this.options.duplicateSubscriptionStrategy;
    if(strategy.disposal === 'collapse') {
      const frames = intent.frames.slice();
      for(const frame of frames) {
        frame();
      }
    } else {
      intent.frames[0]();
    }
  }

  public handlersByEventEntries(): IterableIterator<[EventKeys<TEventMap>|WILDCARD, Set<GenericHandler>]> {
    return this.handlersByEvent.entries();
  }

  public stackedSurplusFor(event: EventKeys<TEventMap>|WILDCARD): number {
    return this.stackedListenerSurplusByEvent.get(event) ?? 0;
  }

  public stackedSurplusTotal(): number {
    let total = 0;
    for(const extra of this.stackedListenerSurplusByEvent.values()) {
      total += extra;
    }
    return total;
  }

  /**
   * @param includeIncognito - when `false`, incognito registrations are left in place
   */
  public releaseAll(includeIncognito: boolean = true): void {
    const pending: Subscription[] = [];
    const collect = (intents: Map<GenericHandler, Map<any, HandlerIntent>>) => {
      for(const byKey of intents.values()) {
        for(const intent of byKey.values()) {
          if(includeIncognito || !intent.incognito) {
            pending.push(...intent.frames);
          }
        }
      }
    };
    collect(this.onIntents);
    collect(this.onceIntents);
    collect(this.anyIntents);
    collect(this.tapIntents);
    over(pending)();
    if(!includeIncognito) {
      return;
    }
    this.handlersByEvent.clear();
    this.incognitoByHandler.clear();
    this.stackedListenerSurplusByEvent.clear();
    this.onIntents.clear();
    this.onceIntents.clear();
    this.anyIntents.clear();
    this.tapIntents.clear();
  }


  public on(
    event: EventKeys<TEventMap>|WILDCARD,
    handler: GenericHandler,
    options?: SubscribeOptions
  ): Subscription {
    return this.registerHandlerIntent({
      kind: 'on',
      intents: this.onIntents,
      listenableKey: event,
      listenableLabel: String(event),
      userHandler: handler,
      emitHandler: handler,
      options,
      honorDisposalConfig: true
    });
  }

  public once(
    event: EventKeys<TEventMap>|WILDCARD,
    handler: GenericHandler,
    options?: SubscribeOptions
  ): Subscription {
    const emitHandler = ((payload: any) => {
      const intent = this.onceIntents.get(handler)?.get(event);
      if(!intent?.frames.length) {
        return;
      }
      const times = Math.max(intent.invokeCount, 1);
      // tear down every once frame for this identity before invoking (once semantics).
      const frames = intent.frames.slice();
      for(const frame of frames) {
        frame();
      }
      for(let i = 0; i < times; i++) {
        handler(payload);
      }
    }) as GenericHandler;

    return this.registerHandlerIntent({
      kind: 'once',
      intents: this.onceIntents,
      listenableKey: event,
      listenableLabel: String(event),
      userHandler: handler,
      emitHandler,
      options,
      // once ignores disposal config: always pop one frame
      honorDisposalConfig: false
    });
  }

  public any(
    events: EventKeys<TEventMap>[],
    handler: EventSink<TEventMap>,
    options?: SubscribeOptions
  ): Subscription {
    const uniqueEvents = canonicalizeEventKeys(events);
    const eventsKey = uniqueEvents.map(String).join('\0');
    const strategy = this.options.duplicateSubscriptionStrategy;
    let byKey = this.anyIntents.get(handler as GenericHandler);
    if(!byKey) {
      byKey = new Map();
      this.anyIntents.set(handler as GenericHandler, byKey);
    }
    const intentsForHandler = byKey;

    const existing = byKey.get(eventsKey);
    if(existing) {
      this.logDuplicate('any', uniqueEvents.map(String).join(','));
      if(strategy.disposal === 'collapse') {
        if(strategy.invocation === 'stack') {
          existing.invokeCount += 1;
        }
        if(strategy.observability === 'stack') {
          existing.observabilityCount += 1;
          this.adjustAnyStackedObservability(uniqueEvents, existing.incognito, 1);
        }
        return existing.frames[0];
      }
      return this.pushIntentFrame(existing, new AnyFrameMeta({
        manager: this,
        lifecycle: this.lifecycle,
        anyIntents: this.anyIntents,
        intent: existing,
        uniqueEvents,
        intentsForHandler,
        eventsKey,
        handler: handler as GenericHandler
      }));
    }

    const wrappers = new Map<EventKeys<TEventMap>, GenericHandler>();
    const intent: HandlerIntent & {
      events: EventKeys<TEventMap>[];
      wrappers: Map<EventKeys<TEventMap>, GenericHandler>;
    } = {
      frames: [],
      invokeCount: 1,
      observabilityCount: 1,
      emitHandler: handler as GenericHandler,
      incognito: options?.incognito === true,
      events: uniqueEvents,
      wrappers
    };

    for(const e of uniqueEvents) {
      const wrapper = ((payload: any) => {
        const times = Math.max(intent.invokeCount, 1);
        for(let i = 0; i < times; i++) {
          (handler as EventSink<TEventMap>)(e as any, payload);
        }
      }) as GenericHandler;
      wrappers.set(e, wrapper);
      this.attachEmitHandler(e, wrapper, intent.incognito, true);
    }
    byKey.set(eventsKey, intent);
    return this.pushIntentFrame(intent, new AnyFrameMeta({
      manager: this,
      lifecycle: this.lifecycle,
      anyIntents: this.anyIntents,
      intent,
      uniqueEvents,
      intentsForHandler,
      eventsKey,
      handler: handler as GenericHandler
    }));
  }

  /** @internal used by the frame metas */
  public adjustAnyStackedObservability(
    events: EventKeys<TEventMap>[],
    incognito: boolean,
    delta: number
  ): void {
    for(const e of events) {
      this.adjustStackedListenerSurplus(e, delta, incognito);
      if(!incognito) {
        if(delta > 0) {
          this.lifecycle.ownListenerWillAdd(e);
          this.lifecycle.ownListenerDidAdd(e);
        } else if(delta < 0) {
          this.lifecycle.ownListenerWillRemove(e);
          this.lifecycle.ownListenerDidRemove(e);
        }
      }
    }
  }

  /** @internal used by the frame metas */
  public teardownAnyEmitHandlers(intent: {
    events: EventKeys<TEventMap>[];
    wrappers: Map<EventKeys<TEventMap>, GenericHandler>;
    incognito: boolean;
  }): void {
    for(const e of intent.events) {
      const wrapper = intent.wrappers.get(e);
      if(wrapper) {
        this.detachEmitHandler(e, wrapper);
      }
    }
  }

  public tap(
    handler: TapHandler<TEventMap>,
    options?: SubscribeOptions
  ): Subscription {
    const existing = this.tapIntents.get(handler as GenericHandler)?.get(WILDCARD);
    const emitHandler: GenericHandler = existing?.emitHandler ?? ((event, payload) => {
      const intent = this.tapIntents.get(handler as GenericHandler)?.get(WILDCARD);
      const times = Math.max(intent?.invokeCount ?? 1, 1);
      for(let i = 0; i < times; i++) {
        handler({event, payload} as PipedMessage<TEventMap>);
      }
    });

    return this.registerHandlerIntent({
      kind: 'tap',
      intents: this.tapIntents,
      listenableKey: WILDCARD,
      listenableLabel: '*',
      userHandler: handler as GenericHandler,
      emitHandler,
      options,
      honorDisposalConfig: true
    });
  }

  private registerHandlerIntent(params: {
    kind: string;
    intents: Map<GenericHandler, Map<any, HandlerIntent>>;
    listenableKey: EventKeys<TEventMap>|WILDCARD;
    listenableLabel: string;
    userHandler: GenericHandler;
    emitHandler: GenericHandler;
    options?: SubscribeOptions;
    honorDisposalConfig: boolean;
  }): Subscription {
    const {
      kind,
      intents,
      listenableKey,
      listenableLabel,
      userHandler,
      emitHandler,
      options,
      honorDisposalConfig
    } = params;
    const strategy = this.options.duplicateSubscriptionStrategy;
    let byKey = intents.get(userHandler);
    if(!byKey) {
      byKey = new Map();
      intents.set(userHandler, byKey);
    }
    const existing = byKey.get(listenableKey);
    if(existing) {
      this.logDuplicate(kind, listenableLabel);
      // once: honorDisposalConfig false → never collapse (always pop one frame)
      const disposalCollapse = honorDisposalConfig && strategy.disposal === 'collapse';
      if(disposalCollapse) {
        if(strategy.invocation === 'stack') {
          existing.invokeCount += 1;
        }
        if(strategy.observability === 'stack') {
          existing.observabilityCount += 1;
          this.adjustSingleStackedObservability(listenableKey, existing.incognito, 1);
        }
        return existing.frames[0];
      }
      return this.pushIntentFrame(existing, this.singleEventFrameMeta({
        honorDisposalConfig,
        listenableKey,
        incognito: existing.incognito,
        emitHandler: existing.emitHandler,
        intents,
        userHandler,
        byKey
      }));
    }

    const incognito = options?.incognito === true;
    const intent: HandlerIntent = {
      frames: [],
      invokeCount: 1,
      observabilityCount: 1,
      emitHandler,
      incognito
    };
    byKey.set(listenableKey, intent);
    this.attachEmitHandler(listenableKey, emitHandler, incognito, true);
    return this.pushIntentFrame(intent, this.singleEventFrameMeta({
      honorDisposalConfig,
      listenableKey,
      incognito,
      emitHandler,
      intents,
      userHandler,
      byKey
    }));
  }

  private singleEventFrameMeta(params: {
    honorDisposalConfig: boolean;
    listenableKey: EventKeys<TEventMap>|WILDCARD;
    incognito: boolean;
    emitHandler: GenericHandler;
    intents: Map<GenericHandler, Map<any, HandlerIntent>>;
    userHandler: GenericHandler;
    byKey: Map<any, HandlerIntent>;
  }): IntentFrameMeta {
    const {
      honorDisposalConfig,
      listenableKey,
      incognito,
      emitHandler,
      intents,
      userHandler,
      byKey
    } = params;
    return new SingleEventFrameMeta({
      manager: this,
      lifecycle: this.lifecycle,
      honorDisposalConfig,
      listenableKey,
      incognito,
      emitHandler,
      intents,
      userHandler,
      byKey
    });
  }

  /** @internal used by the frame metas */
  public adjustSingleStackedObservability(
    event: EventKeys<TEventMap>|WILDCARD,
    incognito: boolean,
    delta: number
  ): void {
    this.adjustStackedListenerSurplus(event, delta, incognito);
    if(!incognito) {
      if(delta > 0) {
        this.lifecycle.ownListenerWillAdd(event);
        this.lifecycle.ownListenerDidAdd(event);
      } else if(delta < 0) {
        this.lifecycle.ownListenerWillRemove(event);
        this.lifecycle.ownListenerDidRemove(event);
      }
    }
  }

  private pushIntentFrame(intent: HandlerIntent, meta: IntentFrameMeta): Subscription {
    const strategy = this.options.duplicateSubscriptionStrategy;
    const isDuplicateFrame = intent.frames.length > 0;
    if(isDuplicateFrame) {
      if(strategy.invocation === 'stack') {
        intent.invokeCount += 1;
      }
      if(strategy.observability === 'stack') {
        intent.observabilityCount += 1;
        meta.adjustStackedObservability(1);
      }
    }

    const sub = subscriptionWrapper(() => {
      this.unsubQueue.push({
        subscription: sub,
        dispose: () => this.disposeIntentFrame(intent, sub, meta)
      });
      this.purgeUnsubQueue();
    });
    intent.frames.push(sub);
    return sub;
  }

  private disposeIntentFrame(
    intent: HandlerIntent,
    sub: Subscription,
    meta: IntentFrameMeta
  ): void {
    const idx = intent.frames.indexOf(sub);
    if(idx === -1) {
      return;
    }
    const strategy = this.options.duplicateSubscriptionStrategy;
    const collapse = meta.honorDisposalConfig && strategy.disposal === 'collapse';

    if(collapse) {
      const obs = intent.observabilityCount;
      intent.frames.length = 0;
      intent.invokeCount = 0;
      intent.observabilityCount = 0;
      if(obs > 1) {
        for(let i = 0; i < obs - 1; i++) {
          meta.adjustStackedObservability(-1);
        }
      }
      meta.fireLifecycleOwnListenerWillRemove();
      meta.onFullyCleared();
      meta.fireLifecycleOwnListenerDidRemove();
      return;
    }

    intent.frames.splice(idx, 1);
    if(strategy.invocation === 'stack' && intent.invokeCount > 0) {
      intent.invokeCount -= 1;
    }

    if(strategy.observability === 'stack' && intent.observabilityCount > 1) {
      intent.observabilityCount -= 1;
      meta.adjustStackedObservability(-1);
    } else if(strategy.observability === 'stack') {
      intent.observabilityCount = 0;
    }

    if(intent.frames.length === 0) {
      meta.fireLifecycleOwnListenerWillRemove();
      meta.onFullyCleared();
      meta.fireLifecycleOwnListenerDidRemove();
    }
  }

  private attachEmitHandler(
    event: EventKeys<TEventMap>|WILDCARD,
    handler: GenericHandler,
    incognito: boolean,
    fireLifecycle: boolean
  ): void {
    if(fireLifecycle && !incognito) {
      this.lifecycle.ownListenerWillAdd(event);
    }
    const prev = this.handlersByEvent.get(event);
    const next = new Set<GenericHandler>(prev);
    const added = !next.has(handler);
    next.add(handler);
    this.handlersByEvent.set(event, next);
    if(incognito) {
      this.markIncognito(handler, event);
    }
    this.host.invalidateCombinedListenerCache();
    this.host.invalidateOwnListenerCache();
    if(fireLifecycle && !incognito) {
      this.lifecycle.ownListenerDidAdd(event);
    }
    if(added) {
      this.logger.onAddListener(event, this.ownListenerCountForEvent(event));
    }
  }

  /** @internal used by the frame metas */
  public detachEmitHandler(
    event: EventKeys<TEventMap>|WILDCARD,
    handler: GenericHandler
  ): void {
    const set = this.handlersByEvent.get(event);
    if(!set?.size) {
      return;
    }
    const removed = set.delete(handler);
    if(removed) {
      this.unmarkIncognito(handler, event);
      if(set.size === 0) {
        this.handlersByEvent.delete(event);
      }
      this.host.invalidateCombinedListenerCache();
      this.host.invalidateOwnListenerCache();
      this.logger.onListenerRemoved(event, this.ownListenerCountForEvent(event));
    }
  }

  public ownListenerCountForEvent(event: EventKeys<TEventMap>|WILDCARD): number {
    const setSize = this.handlersByEvent.get(event)?.size ?? 0;
    const extra = this.stackedListenerSurplusByEvent.get(event) ?? 0;
    return setSize + extra;
  }

  private adjustStackedListenerSurplus(
    event: EventKeys<TEventMap>|WILDCARD,
    delta: number,
    incognito: boolean
  ): void {
    if(incognito) {
      return;
    }
    const curr = this.stackedListenerSurplusByEvent.get(event) ?? 0;
    const next = Math.max(curr + delta, 0);
    if(next === 0) {
      this.stackedListenerSurplusByEvent.delete(event);
    } else {
      this.stackedListenerSurplusByEvent.set(event, next);
    }
  }

  private logDuplicate(kind: string, listenable: string): void {
    this.logger.onDuplicateSubscription(
      kind,
      listenable,
      this.options.duplicateSubscriptionStrategy.logLevel
    );
  }

  private purgeUnsubQueue() {
    if(this._purgingUnsubQueue) {
      return;
    }
    this._purgingUnsubQueue = true;
    while(this.unsubQueue.length) {
      const {dispose} = this.unsubQueue.shift();
      dispose();
    }
    this._purgingUnsubQueue = false;
  }

  public isIncognito(
    handler: GenericHandler,
    event: EventKeys<TEventMap>|WILDCARD
  ): boolean {
    return this.incognitoByHandler.get(handler)?.has(event) ?? false;
  }

  private markIncognito(
    handler: GenericHandler,
    event: EventKeys<TEventMap>|WILDCARD
  ): void {
    let events = this.incognitoByHandler.get(handler);
    if(!events) {
      events = new Set();
      this.incognitoByHandler.set(handler, events);
    }
    events.add(event);
  }

  private unmarkIncognito(
    handler: GenericHandler,
    event: EventKeys<TEventMap>|WILDCARD
  ): void {
    const events = this.incognitoByHandler.get(handler);
    if(!events) {
      return;
    }
    events.delete(event);
    if(events.size === 0) {
      this.incognitoByHandler.delete(handler);
    }
  }

  public consumeEvent(event: EventKeys<TEventMap>|WILDCARD, ...args: any[]): boolean {
    const handlers = this.handlersByEvent.get(event);
    if(handlers && handlers.size) {
      for(const fn of handlers) {
        const times = this.invokeTimesFor(event, fn);
        for(let i = 0; i < times; i++) {
          try {
            const execution = fn(...args);
            (execution as Promise<any>)?.catch?.((e) => {
              this.lifecycle.emitHandlerError(e, event);
            });
          } catch(e: unknown) {
            this.lifecycle.emitHandlerError(e, event);
          }
        }
      }
      return true;
    }
    return false;
  }

  private invokeTimesFor(event: EventKeys<TEventMap>|WILDCARD, emitHandler: GenericHandler): number {
    // `on` intents are keyed by the user's handler, which is the emit handler itself
    const intent = this.onIntents.get(emitHandler)?.get(event);
    if(intent?.emitHandler === emitHandler) {
      return Math.max(intent.invokeCount, 1);
    }
    // once / any / pipe wrappers handle multiplicity internally
    return 1;
  }
}

/**
 * @ignore
 * Stable unique event keys for any-intent identity (order-independent).
 */
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
