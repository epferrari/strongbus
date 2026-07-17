import {type CancelablePromise, cancelable} from 'jaasync';

import {Scanner} from './scanner';
import {type EventMap, type Listenable, WILDCARD} from './types/events';
import type {Scannable} from './types/scannable';
import type {ScanOptions, SubscribeOptions} from './types/surfaces/subscriptionSurface';
import type {EventKeys} from './types/utility';
import {INTERNAL_PROMISE} from './utils/internalPromiseSymbol';
import { autobind } from 'core-decorators';

export interface ScanParams<T, TEventMap extends EventMap> {
  evaluator: Scanner.Evaluator<T, TEventMap>;
  trigger: Listenable<EventKeys<TEventMap>>;
  eager?: boolean;
  pool?: boolean;
  timeout?: number;
  incognito?: boolean;
}

type LazyOrEager = 'eager'|'lazy';
type PoolMode = 'monitored'|'incognito';
type PoolKey = `${LazyOrEager}:${PoolMode}`;

interface Pool<TEventMap extends EventMap> {
  wildcard: Promise<any>|undefined;
  event: Map<Promise<any>, Set<EventKeys<TEventMap>>>[];
}

/**
 * Pools {@link Scanner}s that share an `evaluator`, eagerness, and monitoring mode
 * so that overlapping triggers can reuse an in-flight scan instead of subscribing
 * redundantly. Monitored and incognito scans never share a pool.
 * Each pooled scan tracks a `constituentCount`; the underlying scanner is only
 * canceled once every constituent has been canceled.
 */
@autobind
export class ScannerPools<TEventMap extends EventMap> {
  private readonly pools = new WeakMap<Scanner.Evaluator<any, TEventMap>, Map<PoolKey, Pool<TEventMap>>>();
  private readonly constituencies = new WeakMap<Promise<any>, {
    scanner: CancelablePromise<any>;
    constituentCount: number;
  }>();

  /**
   * Acquire a pooled scan for `params`, reusing an existing scan when its trigger
   * is a superset of the requested trigger, otherwise creating a new one.
   */
  public scan<T>(scannable: Scannable<TEventMap>, params: ScanParams<T, TEventMap>): CancelablePromise<T> {
    /*
    Determine if we can use an existing scanner
    - are the evaluators the same?
    - is the eager flag the same?
    - is the incognito flag the same?
    - is the trigger a subset of an existing trigger?
    */
    const lazyOrEager: LazyOrEager = (params.eager === false) ? 'lazy' : 'eager';
    const poolKey = toPoolKey(lazyOrEager, params.incognito === true);
    const promise = this.getExisting<T>(params, poolKey) || this.createNew<T>(scannable, params, lazyOrEager, poolKey);
    const c = cancelable(() => promise);
    const cancel = c.cancel.bind(c);
    this.constituencies.get(promise).constituentCount++;

    // tslint:disable-next-line:prefer-object-spread
    return Object.assign(
      c,
      {
        [INTERNAL_PROMISE]: promise,
        cancel: (...args: any[]) => {
          if(cancel(...args)) {
            const entry = this.constituencies.get(promise);
            if(entry?.constituentCount > 1) {
              entry.constituentCount--;
            } else if(entry) {
              entry.scanner.cancel();
            }
          }
        }
      }
    );
  }

  private getExisting<T>(params: ScanParams<T, TEventMap>, poolKey: PoolKey): Promise<T>|undefined {
    const pools = this.pools.get(params.evaluator)?.get(poolKey);
    if(pools) {
      if(pools.wildcard) {
        return pools.wildcard;
      } else if(params.trigger !== WILDCARD) {
        const events: Set<EventKeys<TEventMap>> = new Set(Array.isArray(params.trigger) ? params.trigger : [params.trigger]);
        // start comparing with longest candidates first
        const candidatesByEventCountDesc = pools.event.slice(events.size - 1).reverse();
        for(const candidatesOfEventCountN of candidatesByEventCountDesc) {
          evaluateCandidate:
          for(const [_promise, _events] of candidatesOfEventCountN) {
            for(const e of events) {
              if(!_events.has(e as EventKeys<TEventMap>)) {
                continue evaluateCandidate;
              }
            }
            return _promise;
          }
        }
      }
    }
  }

  private createNew<T>(
    scannable: Scannable<TEventMap>,
    params: ScanParams<T, TEventMap>,
    lazyOrEager: LazyOrEager,
    poolKey: PoolKey
  ): Promise<T> {
    const scanner = new Scanner<T>(params);
    const subscribeOptions: SubscribeOptions | undefined = params.incognito
      ? {incognito: true}
      : undefined;
    scanner.scan<TEventMap>(scannable, params.trigger, subscribeOptions);

    let byEvaluator = this.pools.get(params.evaluator);
    if(!byEvaluator) {
      byEvaluator = new Map();
      this.pools.set(params.evaluator, byEvaluator);
    }
    let pools = byEvaluator.get(poolKey);
    if(!pools) {
      pools = {
        wildcard: undefined,
        event: []
      };
      byEvaluator.set(poolKey, pools);
    }

    const _promise = new Promise<T>(
      async (resolve, reject) => {
        try {
          resolve(await scanner);
        } catch(e) {
          reject(e);
        } finally {
          this.constituencies.delete(_promise);
          this.cleanup({
            ...params,
            lazyOrEager,
            poolKey,
            promise: _promise
          });
        }
      }
    );

    this.constituencies.set(_promise, {
      scanner,
      constituentCount: 0
    });

    if(params.trigger === WILDCARD) {
      pools.wildcard = _promise;
    } else {
      const events: Set<EventKeys<TEventMap>> = new Set(Array.isArray(params.trigger) ? params.trigger : [params.trigger]);
      const index = events.size - 1;
      let byEventCount = pools.event[index];
      if(!byEventCount) {
        byEventCount = new Map<Promise<any>, Set<EventKeys<TEventMap>>>();
        pools.event[index] = byEventCount;
      }
      byEventCount.set(_promise, events);
    }
    return _promise;
  }

  private cleanup(params: {
    evaluator: Scanner.Evaluator<any, any>;
    trigger: Listenable<EventKeys<TEventMap>>;
    lazyOrEager: LazyOrEager;
    poolKey: PoolKey;
    promise: Promise<any>;
  }): void {
    const byEvaluator = this.pools.get(params.evaluator);
    if(byEvaluator) {
      const pools = byEvaluator.get(params.poolKey);
      if(pools) {
        if(params.trigger === WILDCARD) {
          pools.wildcard = null;
          if(!pools.event || pools.event?.length === 0) {
            byEvaluator.delete(params.poolKey);
            if(byEvaluator.size === 0) {
              this.pools.delete(params.evaluator);
            }
          }
        } else {
          const byEvent = pools.event;
          if(byEvent) {
            const events: Set<EventKeys<TEventMap>> = new Set(Array.isArray(params.trigger) ? params.trigger : [params.trigger]);
            const index = events.size - 1;
            const byEventCount = byEvent[index];
            if(byEventCount) {
              byEventCount.delete(params.promise);
              if(byEventCount.size === 0 && byEvent.every(b => b.size === 0)) {
                if(!pools.wildcard) {
                  byEvaluator.delete(params.poolKey);
                  if(byEvaluator.size === 0) {
                    this.pools.delete(params.evaluator);
                  }
                } else {
                  pools.event = [];
                }
              }
            }
          }
        }
      }
    }
  }
}

/**
 * @ignore
 */
function toPoolKey(lazyOrEager: LazyOrEager, incognito: boolean): PoolKey {
  return `${lazyOrEager}:${incognito ? 'incognito' : 'monitored'}`;
}

/**
 * @ignore
 */
export function normalizeScanParams<TEventMap extends EventMap>(
  args: readonly unknown[]
): ScanParams<any, TEventMap> {
  const [first, second, third] = args;
  if(
    args.length === 1 &&
    typeof first === 'object' &&
    first !== null &&
    'evaluator' in first &&
    'trigger' in first
  ) {
    return first as ScanParams<any, TEventMap>;
  }

  return {
    trigger: first as ScanParams<any, TEventMap>['trigger'],
    evaluator: second as ScanParams<any, TEventMap>['evaluator'],
    ...(third as ScanOptions | undefined)
  };
}
