import {autobind} from 'core-decorators';
import {CancelablePromise, Deferred} from 'jaasync';
import {EventHandler} from './types/eventHandlers';

import * as Events from './types/events';
import {Lifecycle} from './types/lifecycle';
import {Scannable} from './types/scannable';
import {EventKeys} from './types/utility';
import {over} from './utils/over';


export namespace Scanner {
  export type TriggerType = 'eager'|'event'|'destroy';
  export interface Trigger<TEventMap extends Events.EventMap, T extends keyof TEventMap> {
    type: TriggerType;
    event: T;
    payload: TEventMap[T];
  }
  export interface Resolver<TResult, TEventMap extends Events.EventMap = any> {
    (result: TResult): void;
    resolve: (result: TResult) => void;
    reject: (err?: Error) => void;
    trigger: Trigger<TEventMap, keyof TEventMap>;
  }
  export type Rejecter = (err?: Error) => void;
  export type Evaluator<TResult, TEventMap extends Events.EventMap> = (
    resolve: Resolver<TResult, TEventMap>,
    reject: Rejecter
  ) => void|Promise<void>;

  export interface Params<TResult, TEventMap extends object> {
    evaluator: Evaluator<TResult, TEventMap>;
    eager?: boolean;
  }
}

/**
 * @typeParam TResult - Scanner is resolved with value of this type
 * @implements CancelablePromise<TResult>
 */
@autobind
export class Scanner<TResult> implements CancelablePromise<TResult> {
  private settled: boolean = false;
  private readonly triggerListeners = new Set<Events.Subscription>();
  private readonly willDestroyListeners = new Set<Events.Subscription>();
  private readonly evaluator!: Scanner.Evaluator<TResult, any>;
  private readonly _promise = new Deferred<TResult>();
  public readonly [Symbol.toStringTag]: string = 'Promise';

  constructor(params: Scanner.Params<TResult, any>) {
    const {evaluator, eager = true} = params;
    this.evaluator = evaluator;
    if(eager) {
      this.evaluate<any, any>({
        type: 'eager',
        event: null,
        payload: null
      });
    }
  }

  private evaluate<TEventMap extends Events.EventMap, T extends keyof TEventMap>(trigger: Scanner.Trigger<TEventMap, T>): void|Promise<void> {
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
  public scan<TEventMap extends Events.EventMap>(
    scannable: Scannable<TEventMap>,
    listenable: Events.Listenable<EventKeys<TEventMap>>
  ): this {
    if(this.settled) {
      return this;
    }
    (<T extends EventKeys<TEventMap>>() => {
      const handler: EventHandler<TEventMap, T> = (Array.isArray(listenable) || listenable === Events.WILDCARD)
      ? ((event: T, payload: TEventMap[T]) => {
          this.evaluate({
            type: 'event',
            event,
            payload
          });
        }) as any
      : ((payload: TEventMap[T]) => {
        this.evaluate({
          type: 'event',
          event: listenable,
          payload
        });
      }) as any;
    const listener = scannable.on(listenable, handler);

    const willDestroyListener = scannable.hook(Lifecycle.willDestroy, async () => {
      willDestroyListener();
      this.willDestroyListeners.delete(willDestroyListener);
      if(this.willDestroyListeners.size === 0) {
        await this.evaluate<TEventMap, T>({
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
    })();

    return this;
  }
}