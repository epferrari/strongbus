import {type CancelablePromise, cancelable} from 'jaasync';

import {Scanner} from './scanner';
import {type EventMap, type Listenable, WILDCARD} from './types/events';
import type {Scannable} from './types/scannable';
import type {EventKeys} from './types/utility';
import type {ListenableSubscriber} from './utils/subscribeListenable';
import {INTERNAL_PROMISE} from './utils/internalPromiseSymbol';
import { autobind } from 'core-decorators';

export type ScanTarget<TEventMap extends EventMap> =
  Scannable<TEventMap> & Pick<ListenableSubscriber<TEventMap>, 'any' | 'pipe'>;

export interface ScanParams<T, TEventMap extends EventMap> {
  evaluator: Scanner.Evaluator<T, TEventMap>;
  trigger: Listenable<EventKeys<TEventMap>>;
  eager?: boolean;
  pool?: boolean;
  timeout?: number;
}

type LazyOrEager = 'eager'|'lazy';

interface Pool<TEventMap extends EventMap> {
  wildcard: Promise<any>|undefined;
  event: Map<Promise<any>, Set<EventKeys<TEventMap>>>[];
}

/**
 * Pools [[Scanner]]s that share an `evaluator` and eagerness so that overlapping
 * triggers can reuse an in-flight scan instead of subscribing redundantly.
 * Each pooled scan tracks a `constituentCount`; the underlying scanner is only
 * canceled once every constituent has been canceled.
 */
@autobind
export class ScannerPools<TEventMap extends EventMap> {
  private readonly pools = new WeakMap<Scanner.Evaluator<any, TEventMap>, Map<LazyOrEager, Pool<TEventMap>>>();
  private readonly constituencies = new WeakMap<Promise<any>, {
    scanner: CancelablePromise<any>;
    constituentCount: number;
  }>();

  /**
   * Acquire a pooled scan for `params`, reusing an existing scan when its trigger
   * is a superset of the requested trigger, otherwise creating a new one.
   */
  public scan<T>(scannable: ScanTarget<TEventMap>, params: ScanParams<T, TEventMap>): CancelablePromise<T> {
    /*
    Determine if we can use an existing scanner
    - are the evaluators the same?
    - is the eager flag the same?
    - is the trigger a subset of an existing trigger?
    */
    const lazyOrEager: LazyOrEager = (params.eager === false) ? 'lazy' : 'eager';
    const promise = this.getExisting<T>(params, lazyOrEager) || this.createNew<T>(scannable, params, lazyOrEager);
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

  private getExisting<T>(params: ScanParams<T, TEventMap>, lazyOrEager: LazyOrEager): Promise<T>|undefined {
    const pools = this.pools.get(params.evaluator)?.get(lazyOrEager);
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
    scannable: ScanTarget<TEventMap>,
    params: ScanParams<T, TEventMap>,
    lazyOrEager: LazyOrEager
  ): Promise<T> {
    const scanner = new Scanner<T>(params);
    scanner.scan<TEventMap>(scannable, params.trigger);

    let byEvaluator = this.pools.get(params.evaluator);
    if(!byEvaluator) {
      byEvaluator = new Map();
      this.pools.set(params.evaluator, byEvaluator);
    }
    let pools = byEvaluator.get(lazyOrEager);
    if(!pools) {
      pools = {
        wildcard: undefined,
        event: []
      };
      byEvaluator.set(lazyOrEager, pools);
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
    promise: Promise<any>;
  }): void {
    const byEvaluator = this.pools.get(params.evaluator);
    if(byEvaluator) {
      const pools = byEvaluator.get(params.lazyOrEager);
      if(pools) {
        if(params.trigger === WILDCARD) {
          pools.wildcard = null;
          if(!pools.event || pools.event?.length === 0) {
            byEvaluator.delete(params.lazyOrEager);
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
                  byEvaluator.delete(params.lazyOrEager);
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
