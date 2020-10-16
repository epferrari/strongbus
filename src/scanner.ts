import {autobind} from 'core-decorators';
import {CancelablePromise} from 'jaasync/lib/cancelable';
import {Deferred} from 'jaasync/lib/deferred';

import * as Events from './types/events';
import {Lifecycle} from './types/lifecycle';
import {Scannable} from './types/scannable';
import {over} from './utils/over';


export namespace Scanner {

  export type Resolver<R> = (result: R) => void;
  export type Rejecter = (err?: Error) => void;
  export type Evaluator<R> = (resolve: (result: R) => void, reject: (err?: Error) => void) => void|Promise<void>;

  export interface Params<R> {
    evaluator: Evaluator<R>;
    eager?: boolean;
  }
}

/**
 * @typeParam T - Scanner is resolved with value of this type
 * @implements CancelablePromise<T>
 */
@autobind
export class Scanner<T> implements CancelablePromise<T> {
  private settled: boolean = false;
  private readonly triggerListeners = new Set<Events.Subscription>();
  private readonly willDestroyListeners = new Set<Events.Subscription>();
  private readonly evaluator!: Scanner.Evaluator<T>;
  private readonly _promise = new Deferred<T>();
  public readonly [Symbol.toStringTag]: string = 'Promise';

  constructor(params: Scanner.Params<T>) {
    const {evaluator, eager = true} = params;
    this.evaluator = evaluator;
    if(eager) {
      this.evaluate();
    }
  }

  private evaluate(): void|Promise<void> {
    if(!this.settled) {
      return this.evaluator(this.resolve, this.reject);
    }
  }

  private resolve(value: T): void {
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

  public then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2> {
    return this._promise.then(onfulfilled, onrejected);
  }

  public catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): Promise<T | TResult> {
    return this._promise.catch(onrejected);
  }

  public finally(onfinally?: (() => void) | undefined | null): Promise<T> {
    return this._promise.finally(onfinally);
  }

  public cancel(reason?: string): boolean {
    if(this.settle()) {
      this._promise.reject(reason);
      return true;
    } else {
      return false;
    }
  }

  /**
   * add a scannable/event pair to trigger evaluation on
   */
  public scan<M extends object>(
    scannable: Scannable<M>,
    trigger: Events.Listenable<keyof M>
  ): this {
    if(this.settled) {
      return;
    }
    const triggerListener = scannable.on(trigger, (() => this.evaluate()) as any);
    const willDestroyListener = scannable.hook(Lifecycle.willDestroy, async () => {
      willDestroyListener();
      this.willDestroyListeners.delete(willDestroyListener);
      if(this.willDestroyListeners.size === 0) {
        await this.evaluate();
        if(!this.settled) {
          this.cancel('All Scannables have been destroyed');
        }
      }
    });
    this.triggerListeners.add(triggerListener);
    this.willDestroyListeners.add(willDestroyListener);
    return this;
  }
}