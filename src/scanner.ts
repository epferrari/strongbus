import {autobind} from 'core-decorators';
import {type CancelablePromise, Deferred} from 'jaasync';

import type {EventMap, Subscription, Listenable} from './types/events';
import {Lifecycle} from './types/lifecycle';
import type {Scannable} from './types/scannable';
import type {SubscribeOptions} from './types/surfaces/subscriptionSurface';
import type {EventKeys} from './types/utility';
import {over} from './utils/over';
import {subscribeListenable} from './utils/subscribeListenable';


export namespace Scanner {
  export type TriggerType = 'eager'|'event'|'destroy';

  export type ScanResolverEventTrigger<TEventMap extends EventMap> =
    EventKeys<TEventMap> extends never
      ? { type: 'event'; event: string & {}; payload: unknown }
      : {
          [K in EventKeys<TEventMap>]: {
            type: 'event';
            event: K;
            payload: TEventMap[K];
          };
        }[EventKeys<TEventMap>];

  /**
   * Discriminated trigger passed to {@link Evaluator} resolvers. Known events
   * correlate payload types; any other event name is typed as `unknown`.
   */
  export type ScanResolverTrigger<TEventMap extends EventMap> =
    | { type: 'eager'; event: null; payload: null }
    | { type: 'destroy'; event: null; payload: null }
    | ScanResolverEventTrigger<TEventMap>;

  export interface Resolver<TResult, TEventMap extends EventMap = any> {
    (result: TResult): void;
    resolve: (result: TResult) => void;
    reject: (err?: Error) => void;
    trigger: ScanResolverTrigger<TEventMap>;
  }
  export type Rejecter = (err?: Error) => void;

  /**
   * Declared via the `bivarianceHack` indirection so the event map type parameter
   * is bivariant; this lets a `Bus` over a wider event map satisfy a view over a
   * narrower one (see {@link Bus.scan}).
   */
  export type Evaluator<TResult, in out TEventMap extends EventMap> = {
    bivarianceHack(
      resolve: Resolver<TResult, TEventMap>,
      reject: Rejecter
    ): void|Promise<void>;
  }['bivarianceHack'];

  export interface Params<TResult, TEventMap extends object> {
    evaluator: Evaluator<TResult, TEventMap>;
    eager?: boolean;
  }
}

/**
 * @typeParam TResult - Scanner is resolved with value of this type
 */
@autobind
export class Scanner<TResult> implements CancelablePromise<TResult> {
  private settled: boolean = false;
  private readonly triggerListeners = new Set<Subscription>();
  private readonly willDestroyListeners = new Set<Subscription>();
  private readonly evaluator!: Scanner.Evaluator<TResult, any>;
  private readonly _promise = new Deferred<TResult>();
  public readonly [Symbol.toStringTag]: string = 'Promise';

  constructor(params: Scanner.Params<TResult, any>) {
    const {evaluator, eager = true} = params;
    this.evaluator = evaluator;
    if(eager) {
      this.evaluate<any>({
        type: 'eager',
        event: null,
        payload: null
      });
    }
  }

  private evaluate<TEventMap extends EventMap>(
    trigger: Scanner.ScanResolverTrigger<TEventMap>
  ): void|Promise<void> {
    const resolver = (val: TResult) => this.resolve(val);
    (resolver as any).resolve = this.resolve;
    (resolver as any).reject = this.reject;
    (resolver as any).trigger = trigger;
    if(!this.settled) {
      return this.evaluator(resolver as any, this.reject);
    }
  }

  private resolve(value: TResult): void {
    if(this.settle()) {
      this._promise.resolve(value);
    }
  }

  private reject(err?: Error): void {
    if(this.settle()) {
      this._promise.reject(err);
    }
  }

  private settle(): boolean {
    if(this.settled) {
      return false;
    }
    over(this.triggerListeners)();
    this.triggerListeners.clear();
    over(this.willDestroyListeners)();
    this.willDestroyListeners.clear();
    return (this.settled = true);
  }

  public then<TResult1 = TResult, TResult2 = never>(
    onfulfilled?: ((value: TResult) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2> {
    return this._promise.then(onfulfilled, onrejected);
  }

  public catch<TResult1 = never>(onrejected?: ((reason: any) => TResult1 | PromiseLike<TResult1>) | undefined | null): Promise<TResult1 | TResult1> {
    return this._promise.catch(onrejected) as any;
  }

  public finally(onfinally?: (() => void) | undefined | null): Promise<TResult> {
    return this._promise.finally(onfinally);
  }

  public cancel(reason?: string|Error): boolean {
    if(this.settle()) {
      this._promise.reject(reason);
      return true;
    } else {
      return false;
    }
  }

  /**
   * scan listenable and resolve based on `this.evaluator`
   */
  public scan<TEventMap extends EventMap>(
    scannable: Scannable<TEventMap>,
    listenable: Listenable<EventKeys<TEventMap>>,
    options?: SubscribeOptions
  ): this {
    if(this.settled) {
      return this;
    }

    const listener = subscribeListenable(scannable, listenable, (event, payload) => {
      this.evaluate<TEventMap>({
        type: 'event',
        event,
        payload
      } as Scanner.ScanResolverEventTrigger<TEventMap>);
    }, options);

    const willDestroyListener = scannable.hook(Lifecycle.willDestroy, async () => {
      willDestroyListener();
      this.willDestroyListeners.delete(willDestroyListener);
      if(this.willDestroyListeners.size === 0) {
        await this.evaluate<any>({
          type: 'destroy',
          event: null,
          payload: null
        });
        if(!this.settled) {
          this.cancel('All Scannables have been destroyed');
        }
      }
    });
    this.triggerListeners.add(listener);
    this.willDestroyListeners.add(willDestroyListener);

    return this;
  }
}