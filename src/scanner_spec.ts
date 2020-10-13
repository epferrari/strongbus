import {sleep} from 'jaasync/lib/sleep';

import {Scanner} from './scanner';
import {Bus} from './strongbus';

class Store extends Bus<{value: void}> {
  private _value: 0|1|2 = 0;
  public get value(): 0|1|2 {
    return this._value;
  }
  public set value(value: 0|1|2) {
    if(value !== this._value) {
      this._value = value;
      this.emit('value', null);
    }
  }
}


describe('Scanner', () => {
  let storeA: Store;
  let storeB: Store;
  let onResolve: jasmine.Spy;
  let onReject: jasmine.Spy;

  beforeEach(() => {
    storeA = new Store();
    storeB = new Store();
    onResolve = jasmine.createSpy('onResolve');
    onReject = jasmine.createSpy('onReject');

    const evaluator = (resolve: Scanner.Resolver<boolean>, reject: Scanner.Rejecter) => {
      if(storeA.value === 1 && storeB.value === 1) {
        resolve(true);
      } else if(storeA.value === 2 && storeB.value === 2) {
        reject();
      } else {
        return;
      }
    };
    const s = new Scanner({evaluator});
    s.scan(storeA, 'value');
    s.scan(storeB, 'value');
    s.then(onResolve).catch(onReject);

    storeA.value = 0;
    storeB.value = 0;

    expect(onResolve).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
  });

  describe('given multiple Scannables are being scanned', () => {
    describe("and the evaluation is resolved after one of the Scannables' events", () => {
      it('resolves the promise', async () => {
        storeA.value = 1;
        await sleep(1);
        expect(onResolve).not.toHaveBeenCalled();

        storeB.value = 1;
        await sleep(1);
        expect(onResolve).toHaveBeenCalledWith(true);
        onResolve.calls.reset();

        storeA.emit('value', null);
        await sleep(1);
        expect(onResolve).not.toHaveBeenCalled();
      });

      it('removes listeners from all Scannables', async () => {
        storeA.value = 1;
        storeB.value = 1;
        await sleep(1);

        expect(storeA.listeners.size).toEqual(0);
        expect(storeB.listeners.size).toEqual(0);
      });
    });

    describe("and the evaluation is rejected after one of the Scannables' events", () => {
      it('resolves the promise', async () => {
        storeA.value = 2;
        await sleep(1);
        expect(onReject).not.toHaveBeenCalled();

        storeB.value = 2;
        await sleep(1);
        expect(onReject).toHaveBeenCalled();
        onReject.calls.reset();

        storeA.emit('value', null);
        await sleep(1);
        expect(onReject).not.toHaveBeenCalled();
      });

      it('removes listeners from all Scannables', async () => {
        storeA.value = 2;
        storeB.value = 2;
        await sleep(1);

        expect(storeA.listeners.size).toEqual(0);
        expect(storeB.listeners.size).toEqual(0);
      });
    });

    describe('and all scanned buses are destroyed', () => {
      it('rejects the promise', async () => {
        storeA.destroy();
        storeB.destroy();
        await sleep(1);

        expect(onReject).toHaveBeenCalledWith('All Scannables have been destroyed');
      });
    });

    describe('and the evaluator determines it is already in the desired state', () => {
      describe('given params.eager is true (default)', () => {
        it('resolves the promise immediately and does not add listeners to the Scannable', async () => {
          const evaluator = (resolve: Scanner.Resolver<boolean>, reject: Scanner.Rejecter) => {
            if(storeA.value === 1 && storeB.value === 1) {
              resolve(true);
            } else if(storeA.value === 2 && storeB.value === 2) {
              reject();
            } else {
              return;
            }
          };
          storeA.value = 1;
          storeB.value = 1;
          (async() => {
            try {
              const s2 = new Scanner({evaluator})
                .scan(storeA, 'value')
                .scan(storeB, 'value');
              const result = await s2;
              onResolve(result);
            } catch(e) {
              onReject(e);
            }
          })();

          await sleep(1);
          expect(onResolve).toHaveBeenCalled();
          expect(storeA.listeners.size).toEqual(0);
          expect(storeB.listeners.size).toEqual(0);
        });
      });

      describe('given params.eager is false', () => {
        it('does not resolve the promise immediately', async () => {
          const evaluator = (resolve: Scanner.Resolver<boolean>, reject: Scanner.Rejecter) => {
            if(storeA.value === 1 && storeB.value === 1) {
              resolve(true);
            } else if(storeA.value === 2 && storeB.value === 2) {
              reject();
            } else {
              return;
            }
          };
          storeA.value = 1;
          storeB.value = 1;
          const noEagerResolve = jasmine.createSpy('noEagerResolve');
          const noEagerReject = jasmine.createSpy('noEagerReject');
          (async() => {
            try {
              const s2 = new Scanner({evaluator, eager: false})
                .scan(storeA, 'value')
                .scan(storeB, 'value');
              const result = await s2;
              noEagerResolve(result);
            } catch(e) {
              noEagerReject(e);
            }
          })();

          await sleep(1);
          expect(noEagerResolve).not.toHaveBeenCalled();

          storeA.emit('value', null);
          await sleep(1);
          expect(noEagerResolve).toHaveBeenCalled();

          expect(storeA.listeners.size).toEqual(0);
          expect(storeB.listeners.size).toEqual(0);
        });
      });
    });
  });
});