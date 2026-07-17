import {type Subscription, type EventMap, WILDCARD} from './types/events';
import type {EventSink, PipeSink, PipeMessage, PipeForward, GenericHandler} from './types/eventHandlers';
import type {DuplicateSubscriptionStrategy} from './types/options';
import type {SubscribeOptions} from './types/surfaces/subscriptionSurface';
import type {EventKeys} from './types/utility';
import type {LifecycleManager} from './lifecycleManager';
import {StrongbusLogMessages, type StrongbusLogger} from './strongbusLogger';
import type {Forwards} from './forwards';
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
 * @ignore
 * Host surface {@link SubscriptionRegistry} needs from {@link Bus} (lifecycle, logging, caches).
 */
export type SubscriptionHost<TEventMap extends EventMap> = {
  readonly duplicateSubscriptionStrategy: DuplicateSubscriptionStrategy;
  readonly lifecycle: LifecycleManager<TEventMap>;
  readonly logger: StrongbusLogger<TEventMap>;
  readonly forwards: Forwards;
  readonly name: string;
  invalidateOwnListenerCache(): void;
  invalidateCombinedListenerCache(): void;
};

/**
 * @ignore
 * Owns duplicate-subscription stacks, emit-handler storage, and unsub queue.
 */
export class SubscriptionRegistry<TEventMap extends EventMap> {

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
  private readonly pipeIntents = new Map<
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


  private readonly host: SubscriptionHost<TEventMap>;

  constructor(host: SubscriptionHost<TEventMap>) {
    this.host = host;
  }

  public off(event: EventKeys<TEventMap>|WILDCARD, handler: GenericHandler): void {
    const intent = this.onIntents.get(handler)?.get(event);
    if(!intent?.frames.length) {
      return;
    }
    const strategy = this.host.duplicateSubscriptionStrategy;
    if(strategy.disposal === 'collapse') {
      const frames = intent.frames.slice();
      for(const frame of frames) {
        frame();
      }
    } else {
      intent.frames[0]();
    }
  }

  public unpipeSink(sink: PipeSink<TEventMap>): void {
    const intent = this.pipeIntents.get(sink as GenericHandler)?.get(WILDCARD);
    if(intent?.frames.length) {
      const frames = intent.frames.slice();
      for(const frame of frames) {
        frame();
      }
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

  public releaseAll(): void {
    const pending: Subscription[] = [];
    const collect = (intents: Map<GenericHandler, Map<any, {frames: Subscription[]}>>) => {
      for(const byKey of intents.values()) {
        for(const intent of byKey.values()) {
          pending.push(...intent.frames);
        }
      }
    };
    collect(this.onIntents);
    collect(this.onceIntents);
    collect(this.anyIntents);
    collect(this.pipeIntents);
    over(pending)();
    this.handlersByEvent.clear();
    this.incognitoByHandler.clear();
    this.stackedListenerSurplusByEvent.clear();
    this.onIntents.clear();
    this.onceIntents.clear();
    this.anyIntents.clear();
    this.pipeIntents.clear();
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
    const strategy = this.host.duplicateSubscriptionStrategy;
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
      return this.pushIntentFrame(existing, {
        honorDisposalConfig: true,
        onFullyCleared: () => {
          this.teardownAnyEmitHandlers(existing);
          intentsForHandler.delete(eventsKey);
          if(intentsForHandler.size === 0) {
            this.anyIntents.delete(handler as GenericHandler);
          }
        },
        adjustStackedObservability: (delta) => {
          this.adjustAnyStackedObservability(uniqueEvents, existing.incognito, delta);
        },
        fireLifecycleOwnListenerWillRemove: () => {
          if(existing.incognito) {
            return;
          }
          for(const e of uniqueEvents) {
            this.host.lifecycle.ownListenerWillRemove(e);
          }
        },
        fireLifecycleOwnListenerDidRemove: () => {
          if(existing.incognito) {
            return;
          }
          for(const e of uniqueEvents) {
            this.host.lifecycle.ownListenerDidRemove(e);
          }
        }
      });
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
    return this.pushIntentFrame(intent, {
      honorDisposalConfig: true,
      onFullyCleared: () => {
        this.teardownAnyEmitHandlers(intent);
        intentsForHandler.delete(eventsKey);
        if(intentsForHandler.size === 0) {
          this.anyIntents.delete(handler as GenericHandler);
        }
      },
      adjustStackedObservability: (delta) => {
        this.adjustAnyStackedObservability(uniqueEvents, intent.incognito, delta);
      },
      fireLifecycleOwnListenerWillRemove: () => {
        if(intent.incognito) {
          return;
        }
        for(const e of uniqueEvents) {
          this.host.lifecycle.ownListenerWillRemove(e);
        }
      },
      fireLifecycleOwnListenerDidRemove: () => {
        if(intent.incognito) {
          return;
        }
        for(const e of uniqueEvents) {
          this.host.lifecycle.ownListenerDidRemove(e);
        }
      }
    });
  }

  private adjustAnyStackedObservability(
    events: EventKeys<TEventMap>[],
    incognito: boolean,
    delta: number
  ): void {
    for(const e of events) {
      this.adjustStackedListenerSurplus(e, delta, incognito);
      if(!incognito) {
        if(delta > 0) {
          this.host.lifecycle.ownListenerWillAdd(e);
          this.host.lifecycle.ownListenerDidAdd(e);
        } else if(delta < 0) {
          this.host.lifecycle.ownListenerWillRemove(e);
          this.host.lifecycle.ownListenerDidRemove(e);
        }
      }
    }
  }

  private teardownAnyEmitHandlers(intent: {
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

  public pipeSink(
    sink: PipeSink<TEventMap>,
    options?: SubscribeOptions
  ): Subscription {
    const existing = this.pipeIntents.get(sink as GenericHandler)?.get(WILDCARD);
    const emitHandler: GenericHandler = existing?.emitHandler ?? ((event, payload) => {
      const intent = this.pipeIntents.get(sink as GenericHandler)?.get(WILDCARD);
      const times = Math.max(intent?.invokeCount ?? 1, 1);
      const forward = ((target: {emit: (event: any, payload: any) => boolean}) =>
        this.host.forwards.enqueue(() => target.emit(event, payload))
      ) as PipeForward<TEventMap>;
      for(let i = 0; i < times; i++) {
        sink({event, payload} as PipeMessage<TEventMap>, forward);
      }
    });

    return this.registerHandlerIntent({
      kind: 'pipe',
      intents: this.pipeIntents,
      listenableKey: WILDCARD,
      listenableLabel: '*',
      userHandler: sink as GenericHandler,
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
    const strategy = this.host.duplicateSubscriptionStrategy;
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
    return {
      honorDisposalConfig,
      onFullyCleared: () => {
        this.detachEmitHandler(listenableKey, emitHandler);
        byKey.delete(listenableKey);
        if(byKey.size === 0) {
          intents.delete(userHandler);
        }
      },
      adjustStackedObservability: (delta) => {
        this.adjustSingleStackedObservability(listenableKey, incognito, delta);
      },
      fireLifecycleOwnListenerWillRemove: () => {
        if(!incognito) {
          this.host.lifecycle.ownListenerWillRemove(listenableKey);
        }
      },
      fireLifecycleOwnListenerDidRemove: () => {
        if(!incognito) {
          this.host.lifecycle.ownListenerDidRemove(listenableKey);
        }
      }
    };
  }

  private adjustSingleStackedObservability(
    event: EventKeys<TEventMap>|WILDCARD,
    incognito: boolean,
    delta: number
  ): void {
    this.adjustStackedListenerSurplus(event, delta, incognito);
    if(!incognito) {
      if(delta > 0) {
        this.host.lifecycle.ownListenerWillAdd(event);
        this.host.lifecycle.ownListenerDidAdd(event);
      } else if(delta < 0) {
        this.host.lifecycle.ownListenerWillRemove(event);
        this.host.lifecycle.ownListenerDidRemove(event);
      }
    }
  }

  private pushIntentFrame(intent: HandlerIntent, meta: IntentFrameMeta): Subscription {
    const strategy = this.host.duplicateSubscriptionStrategy;
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
    const strategy = this.host.duplicateSubscriptionStrategy;
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
      this.host.lifecycle.ownListenerWillAdd(event);
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
      this.host.lifecycle.ownListenerDidAdd(event);
    }
    if(added) {
      this.host.logger.onAddListener(event, this.ownListenerCountForEvent(event));
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
      this.unmarkIncognito(handler, event);
      if(set.size === 0) {
        this.handlersByEvent.delete(event);
      }
      this.host.invalidateCombinedListenerCache();
      this.host.invalidateOwnListenerCache();
      this.host.logger.onListenerRemoved(event, this.ownListenerCountForEvent(event));
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
    this.host.logger.onDuplicateSubscription(
      StrongbusLogMessages.duplicateSubscription(this.host.name, kind, listenable),
      this.host.duplicateSubscriptionStrategy.logLevel
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
              this.host.lifecycle.emitHandlerError(e, event);
            });
          } catch(e: unknown) {
            this.host.lifecycle.emitHandlerError(e, event);
          }
        }
      }
      return true;
    }
    return false;
  }

  private invokeTimesFor(event: EventKeys<TEventMap>|WILDCARD, emitHandler: GenericHandler): number {
    for(const byEvent of this.onIntents.values()) {
      const intent = byEvent.get(event);
      if(intent?.emitHandler === emitHandler) {
        return Math.max(intent.invokeCount, 1);
      }
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
