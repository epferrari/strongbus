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
  let initialState: {a: 0|1|2, b: 0|1|2};
  let onEvaluate: jasmine.Spy;
  let onResolve: jasmine.Spy;
  let onReject: jasmine.Spy;

  beforeEach(() => {
    storeA = new Store();
    storeB = new Store();
    onEvaluate = jasmine.createSpy('onEvaluate');
    onResolve = jasmine.createSpy('onResolve');
    onReject = jasmine.createSpy('onReject');
  });

  async function setup(params: {a: 0|1|2, b: 0|1|2, eager: boolean}): Promise<void> {
    const {a, b, eager} = params;

    onEvaluate.calls.reset();
    onResolve.calls.reset();
    onReject.calls.reset();

    const evaluator = (resolve: Scanner.Resolver<boolean>, reject: Scanner.Rejecter) => {
      onEvaluate();
      if(storeA.value === 1 && storeB.value === 1) {
        resolve(true);
      } else if(storeA.value === 2 && storeB.value === 2) {
        reject();
      } else {
        return;
      }
    };

    storeA.value = a;
    storeB.value = b;

    const s = new Scanner({evaluator, eager})
      .scan(storeA, 'value')
      .scan(storeB, 'value');

    s.then(onResolve).catch(onReject);

    await sleep(1);
  }

  describe('given multiple Scannables are being scanned for a single event', () => {
    describe("and neither the evaluator's resolution nor rejection criteria are met when the Scanner is created", () => {

      beforeEach(() => {
        initialState = {a: 0, b: 0};
      });

      describe('given eager evaluation is true (default)', () => {
        beforeEach(async () => {
          await setup({
            ...initialState,
            eager: true
          });
        });
  
        it('adds listeners to the Scannables', () => {
          expect(storeA.listeners.size).toEqual(1);
          expect(storeB.listeners.size).toEqual(1);
        });

        it('immediately invokes the evaluator', () => {
          expect(onEvaluate).toHaveBeenCalled();
        });

        it('resolve/reject handlers are not invoked', () => {
          expect(onResolve).not.toHaveBeenCalled();
          expect(onReject).not.toHaveBeenCalled();
        });

        describe('and all scanned buses are destroyed', () => {
          beforeEach(async () => {
            storeA.destroy();
            storeB.destroy();
            await sleep(1);
          });
          it('rejects the promise', () => {
            expect(onReject).toHaveBeenCalledWith('All Scannables have been destroyed');
          });
  
          it('removes all listeners on all Scannables', async () => {    
            expect(storeA.listeners.size).toEqual(0);
            expect(storeB.listeners.size).toEqual(0);
          });
        });

        describe('given one of the Scannables raises a monitored event', () => {

          beforeEach(() => {
            onResolve.calls.reset();
            onReject.calls.reset();
            onEvaluate.calls.reset();
          });
  
          describe("and the neither the evaluator's resolution nor rejection criteria are met", () => {
            beforeEach(async () => {
              storeA.value = 1;
              await sleep(1);
            });
  
            it('invokes the evaluator', () => {
              expect(onEvaluate).toHaveBeenCalledTimes(1);
            });
    
            it('resolve/reject handlers are not invoked', () => {
              expect(onResolve).not.toHaveBeenCalled();
              expect(onReject).not.toHaveBeenCalled();
            });
  
            it('does not affect listeners on Scannables', async () => {    
              expect(storeA.listeners.size).toEqual(1);
              expect(storeB.listeners.size).toEqual(1);
            });
          });
  
          describe("and the evaluator's resolution criteria are met", () => {
            beforeEach(async () => {
  
              storeA.value = 1;
              storeB.value = 1;
              await sleep(1);
            });
  
            it('invokes the evaluator', () => {
              expect(onEvaluate).toHaveBeenCalledTimes(2);
            });
  
            it("resolves the Scanner's promise", () => {
              expect(onResolve).toHaveBeenCalledWith(true);
              expect(onReject).not.toHaveBeenCalled();
            });
  
            it('removes listeners from all Scannables', async () => {    
              expect(storeA.listeners.size).toEqual(0);
              expect(storeB.listeners.size).toEqual(0);
            });
  
            describe('given one of the Scannables raises a monitored event again', () => {
              beforeEach(() => {
                onResolve.calls.reset();
                onReject.calls.reset();
                onEvaluate.calls.reset();
              });
      
              describe("and neither the evaluator's resolution or rejection criteria are met", () => {
                beforeEach(async () => {
                  storeA.value = 0;
                  await sleep(1);
                });
      
                it('does not invoke the evalutator again', () => {
                  expect(onEvaluate).not.toHaveBeenCalled();
                });
              });
      
              describe("and the evaluator's resolution criteria are met", () => {
                beforeEach(async () => {
                  storeA.value = 1;
                  storeB.value = 1;
                  await sleep(1);
                });
      
                it('does not invoke the evalutator again', () => {
                  expect(onEvaluate).not.toHaveBeenCalled();
                });
      
                it('does not attempt to re-resolve the scanner', () => {
                  expect(onResolve).not.toHaveBeenCalled();
                  expect(onReject).not.toHaveBeenCalled();
                });
              });
      
              describe("and the evaluator's rejection criteria are met", () => {
                beforeEach(async () => {
                  storeA.value = 2;
                  storeB.value = 2;
                  await sleep(1);
                });
      
                it('does not invoke the evalutator again', () => {
                  expect(onEvaluate).not.toHaveBeenCalled();
                });
      
                it('does not attempt to re-reject the scanner', () => {
                  expect(onResolve).not.toHaveBeenCalled();
                  expect(onReject).not.toHaveBeenCalled();
                });
              });
            });
          });
  
          describe("and the evaluator's rejection criteria are met", () => {
            beforeEach(async () => {
              storeA.value = 2;
              storeB.value = 2;
              await sleep(1);
            });
  
            it('invokes the evaluator', () => {
              expect(onEvaluate).toHaveBeenCalledTimes(2);
            });
  
            it("rejects the Scanner's promise", () => {
              expect(onResolve).not.toHaveBeenCalled();
              expect(onReject).toHaveBeenCalled();
            });
  
            it('removes listeners from all Scannables', async () => {    
              expect(storeA.listeners.size).toEqual(0);
              expect(storeB.listeners.size).toEqual(0);
            });
  
            describe('given one of the Scannables raises a monitored event again', () => {
              beforeEach(() => {
                onResolve.calls.reset();
                onReject.calls.reset();
                onEvaluate.calls.reset();
              });
      
              describe("and neither the evaluator's resolution or rejection criteria are met", () => {
                beforeEach(async () => {
                  storeA.value = 0;
                  await sleep(1);
                });
      
                it('does not invoke the evalutator again', () => {
                  expect(onEvaluate).not.toHaveBeenCalled();
                });
              });
      
              describe("and the evaluator's resolution criteria are met", () => {
                beforeEach(async () => {
                  storeA.value = 1;
                  storeB.value = 1;
                  await sleep(1);
                });
      
                it('does not invoke the evalutator again', () => {
                  expect(onEvaluate).not.toHaveBeenCalled();
                });
      
                it('does not attempt to re-resolve the scanner', () => {
                  expect(onResolve).not.toHaveBeenCalled();
                  expect(onReject).not.toHaveBeenCalled();
                });
              });
      
              describe("and the evaluator's rejection criteria are met", () => {
                beforeEach(async () => {
                  storeA.value = 2;
                  storeB.value = 2;
                  await sleep(1);
                });
      
                it('does not invoke the evalutator again', () => {
                  expect(onEvaluate).not.toHaveBeenCalled();
                });
      
                it('does not attempt to re-reject the scanner', () => {
                  expect(onResolve).not.toHaveBeenCalled();
                  expect(onReject).not.toHaveBeenCalled();
                });
              });
            });
          });
        });
      });

      describe('given eager evaluation is false', () => {
        beforeEach(async () => {
          await setup({
            ...initialState,
            eager: false
          });
        });
  
        it('adds listeners to the Scannables', () => {
          expect(storeA.listeners.size).toEqual(1);
          expect(storeB.listeners.size).toEqual(1);
        });

        it('does not immediately invoke the evaluator', () => {
          expect(onEvaluate).not.toHaveBeenCalled();
        });

        it('resolve/reject handlers are not invoked', () => {
          expect(onResolve).not.toHaveBeenCalled();
          expect(onReject).not.toHaveBeenCalled();
        });

        describe('and all scanned buses are destroyed', () => {
          beforeEach(async () => {
            storeA.destroy();
            storeB.destroy();
            await sleep(1);
          });
          it('rejects the promise', () => {
            expect(onReject).toHaveBeenCalledWith('All Scannables have been destroyed');
          });
  
          it('removes all listeners on all Scannables', async () => {    
            expect(storeA.listeners.size).toEqual(0);
            expect(storeB.listeners.size).toEqual(0);
          });
        });

        describe('given one of the Scannables raises a monitored event', () => {

          beforeEach(() => {
            onResolve.calls.reset();
            onReject.calls.reset();
            onEvaluate.calls.reset();
          });
  
          describe("and the neither the evaluator's resolution nor rejection criteria are met", () => {
            beforeEach(async () => {
              storeA.value = 1;
              await sleep(1);
            });
  
            it('invokes the evaluator', () => {
              expect(onEvaluate).toHaveBeenCalledTimes(1);
            });
    
            it('resolve/reject handlers are not invoked', () => {
              expect(onResolve).not.toHaveBeenCalled();
              expect(onReject).not.toHaveBeenCalled();
            });
  
            it('does not affect listeners on Scannables', async () => {    
              expect(storeA.listeners.size).toEqual(1);
              expect(storeB.listeners.size).toEqual(1);
            });
          });
  
          describe("and the evaluator's resolution criteria are met", () => {
            beforeEach(async () => {
  
              storeA.value = 1;
              storeB.value = 1;
              await sleep(1);
            });
  
            it('invokes the evaluator', () => {
              expect(onEvaluate).toHaveBeenCalledTimes(2);
            });
  
            it("resolves the Scanner's promise", () => {
              expect(onResolve).toHaveBeenCalledWith(true);
              expect(onReject).not.toHaveBeenCalled();
            });
  
            it('removes listeners from all Scannables', async () => {    
              expect(storeA.listeners.size).toEqual(0);
              expect(storeB.listeners.size).toEqual(0);
            });
  
            describe('given one of the Scannables raises a monitored event again', () => {
              beforeEach(() => {
                onResolve.calls.reset();
                onReject.calls.reset();
                onEvaluate.calls.reset();
              });
      
              describe("and neither the evaluator's resolution or rejection criteria are met", () => {
                beforeEach(async () => {
                  storeA.value = 0;
                  await sleep(1);
                });
      
                it('does not invoke the evalutator again', () => {
                  expect(onEvaluate).not.toHaveBeenCalled();
                });
              });
      
              describe("and the evaluator's resolution criteria are met", () => {
                beforeEach(async () => {
                  storeA.value = 1;
                  storeB.value = 1;
                  await sleep(1);
                });
      
                it('does not invoke the evalutator again', () => {
                  expect(onEvaluate).not.toHaveBeenCalled();
                });
      
                it('does not attempt to re-resolve the scanner', () => {
                  expect(onResolve).not.toHaveBeenCalled();
                  expect(onReject).not.toHaveBeenCalled();
                });
              });
      
              describe("and the evaluator's rejection criteria are met", () => {
                beforeEach(async () => {
                  storeA.value = 2;
                  storeB.value = 2;
                  await sleep(1);
                });
      
                it('does not invoke the evalutator again', () => {
                  expect(onEvaluate).not.toHaveBeenCalled();
                });
      
                it('does not attempt to re-reject the scanner', () => {
                  expect(onResolve).not.toHaveBeenCalled();
                  expect(onReject).not.toHaveBeenCalled();
                });
              });
            });
          });
  
          describe("and the evaluator's rejection criteria are met", () => {
            beforeEach(async () => {
              storeA.value = 2;
              storeB.value = 2;
              await sleep(1);
            });
  
            it('invokes the evaluator', () => {
              expect(onEvaluate).toHaveBeenCalledTimes(2);
            });
  
            it("rejects the Scanner's promise", () => {
              expect(onResolve).not.toHaveBeenCalled();
              expect(onReject).toHaveBeenCalled();
            });
  
            it('removes listeners from all Scannables', async () => {    
              expect(storeA.listeners.size).toEqual(0);
              expect(storeB.listeners.size).toEqual(0);
            });
  
            describe('given one of the Scannables raises a monitored event again', () => {
              beforeEach(() => {
                onResolve.calls.reset();
                onReject.calls.reset();
                onEvaluate.calls.reset();
              });
      
              describe("and neither the evaluator's resolution or rejection criteria are met", () => {
                beforeEach(async () => {
                  storeA.value = 0;
                  await sleep(1);
                });
      
                it('does not invoke the evalutator again', () => {
                  expect(onEvaluate).not.toHaveBeenCalled();
                });
              });
      
              describe("and the evaluator's resolution criteria are met", () => {
                beforeEach(async () => {
                  storeA.value = 1;
                  storeB.value = 1;
                  await sleep(1);
                });
      
                it('does not invoke the evalutator again', () => {
                  expect(onEvaluate).not.toHaveBeenCalled();
                });
      
                it('does not attempt to re-resolve the scanner', () => {
                  expect(onResolve).not.toHaveBeenCalled();
                  expect(onReject).not.toHaveBeenCalled();
                });
              });
      
              describe("and the evaluator's rejection criteria are met", () => {
                beforeEach(async () => {
                  storeA.value = 2;
                  storeB.value = 2;
                  await sleep(1);
                });
      
                it('does not invoke the evalutator again', () => {
                  expect(onEvaluate).not.toHaveBeenCalled();
                });
      
                it('does not attempt to re-reject the scanner', () => {
                  expect(onResolve).not.toHaveBeenCalled();
                  expect(onReject).not.toHaveBeenCalled();
                });
              });
            });
          });
        });
      });
   
      
    });

    describe("and the evaluator's resolution criteria are met when the Scanner is created", () => {
      beforeEach(() => {
        initialState = {a: 1, b: 1};
      });

      describe('given eager evaluation is true (default)', () => {
        beforeEach(async () => {
          await setup({
            ...initialState,
            eager: true
          });
        });

        it('immediately invokes the evaluator', () => {
          expect(onEvaluate).toHaveBeenCalled();
        });

        it('resolve/reject handlers are not invoked', () => {
          expect(onResolve).toHaveBeenCalledWith(true);
          expect(onReject).not.toHaveBeenCalled();
        });

        it('adds no listeners to the Scannables', () => {
          expect(storeA.listeners.size).toEqual(0);
          expect(storeB.listeners.size).toEqual(0);
        });

        describe('and all scanned buses are destroyed', () => {
          it('has no effect', async () => {
            onReject.calls.reset();

            storeA.destroy();
            storeB.destroy();
            await sleep(1);
    
            expect(onReject).not.toHaveBeenCalled();
          });
        });

        describe('and one of the Scannables raises a monitored event', () => {
          beforeEach(() => {
            onResolve.calls.reset();
            onReject.calls.reset();
            onEvaluate.calls.reset();
          });
  
          describe("given neither the evaluator's resolution or rejection criteria are met", () => {
            beforeEach(async () => {
              storeA.value = 0;
              await sleep(1);
            });
  
            it('does not invoke the evalutator again', () => {
              expect(onEvaluate).not.toHaveBeenCalled();
            });
          });
  
          describe("given the evaluator's resolution criteria are met", () => {
            beforeEach(async () => {
              storeA.value = 1;
              storeB.value = 1;
              await sleep(1);
            });
  
            it('does not invoke the evalutator again', () => {
              expect(onEvaluate).not.toHaveBeenCalled();
            });
  
            it('does not attempt to re-resolve the scanner', () => {
              expect(onResolve).not.toHaveBeenCalled();
              expect(onReject).not.toHaveBeenCalled();
            });
          });
  
          describe("given the evaluator's rejection criteria are met", () => {
            beforeEach(async () => {
              storeA.value = 2;
              storeB.value = 2;
              await sleep(1);
            });
  
            it('does not invoke the evalutator again', () => {
              expect(onEvaluate).not.toHaveBeenCalled();
            });
  
            it('does not attempt to re-reject the scanner', () => {
              expect(onResolve).not.toHaveBeenCalled();
              expect(onReject).not.toHaveBeenCalled();
            });
          });
        });
      });

      describe('given eager evaluation is false', () => {
        beforeEach(async () => {
          await setup({
            ...initialState,
            eager: false
          });
        });

        it('does not immediately invoke the evaluator', () => {
          expect(onEvaluate).not.toHaveBeenCalled();
        });

        it('resolve/reject handlers are not invoked', () => {
          expect(onResolve).not.toHaveBeenCalled();
          expect(onReject).not.toHaveBeenCalled();
        });

        it('does not affect listeners on Scannables', async () => {    
          expect(storeA.listeners.size).toEqual(1);
          expect(storeB.listeners.size).toEqual(1);
        });

        describe('and all scanned buses are destroyed', () => {
          beforeEach(async () => {
            storeA.destroy();
            storeB.destroy();
            await sleep(1);
          });

          it("Resolves the Scanner's promise", () => {

            expect(onEvaluate).toHaveBeenCalled();
            expect(onResolve).toHaveBeenCalledWith(true);
            expect(onReject).not.toHaveBeenCalled();
          });

          it('removes all listeners on all Scannables', async () => {    
            expect(storeA.listeners.size).toEqual(0);
            expect(storeB.listeners.size).toEqual(0);
          });
        });
      });
    });

    describe("and the evaluator's rejection critera are met when the Scanner is created", () => {
      beforeEach(() => {
        initialState = {a: 2, b: 2};
      });

      describe('given eager evaluation is true (default)', () => {
        beforeEach(async () => {
          await setup({
            ...initialState,
            eager: true
          });
        });

        it('immediately invokes the evaluator', () => {
          expect(onEvaluate).toHaveBeenCalled();
        });

        it('resolve/reject handlers are not invoked', () => {
          expect(onResolve).not.toHaveBeenCalled();
          expect(onReject).toHaveBeenCalled();
        });

        it('adds no listeners to the Scannables', () => {
          expect(storeA.listeners.size).toEqual(0);
          expect(storeB.listeners.size).toEqual(0);
        });

        describe('and all scanned buses are destroyed', () => {
          it('has no effect', async () => {
            onReject.calls.reset();

            storeA.destroy();
            storeB.destroy();
            await sleep(1);
    
            expect(onReject).not.toHaveBeenCalled();
          });
        });

        describe('and one of the Scannables raises a monitored event', () => {
          beforeEach(() => {
            onResolve.calls.reset();
            onReject.calls.reset();
            onEvaluate.calls.reset();
          });
  
          describe("given neither the evaluator's resolution or rejection criteria are met", () => {
            beforeEach(async () => {
              storeA.value = 0;
              await sleep(1);
            });
  
            it('does not invoke the evalutator again', () => {
              expect(onEvaluate).not.toHaveBeenCalled();
            });
          });
  
          describe("given the evaluator's resolution criteria are met", () => {
            beforeEach(async () => {
              storeA.value = 1;
              storeB.value = 1;
              await sleep(1);
            });
  
            it('does not invoke the evalutator again', () => {
              expect(onEvaluate).not.toHaveBeenCalled();
            });
  
            it('does not attempt to re-resolve the scanner', () => {
              expect(onResolve).not.toHaveBeenCalled();
              expect(onReject).not.toHaveBeenCalled();
            });
          });
  
          describe("given the evaluator's rejection criteria are met", () => {
            beforeEach(async () => {
              storeA.value = 2;
              storeB.value = 2;
              await sleep(1);
            });
  
            it('does not invoke the evalutator again', () => {
              expect(onEvaluate).not.toHaveBeenCalled();
            });
  
            it('does not attempt to re-reject the scanner', () => {
              expect(onResolve).not.toHaveBeenCalled();
              expect(onReject).not.toHaveBeenCalled();
            });
          });
        });
      });

      describe('given eager evaluation is false', () => {
        beforeEach(async () => {
          await setup({
            ...initialState,
            eager: false
          });
        });

        it('does not immediately invoke the evaluator', () => {
          expect(onEvaluate).not.toHaveBeenCalled();
        });

        it('resolve/reject handlers are not invoked', () => {
          expect(onResolve).not.toHaveBeenCalled();
          expect(onReject).not.toHaveBeenCalled();
        });

        it('does not affect listeners on Scannables', async () => {    
          expect(storeA.listeners.size).toEqual(1);
          expect(storeB.listeners.size).toEqual(1);
        });

        describe('and all scanned buses are destroyed', () => {
          beforeEach(async () => {
            storeA.destroy();
            storeB.destroy();
            await sleep(1);
          });

          it("Rejects the Scanner's promise", async () => {
            expect(onEvaluate).toHaveBeenCalled();
            expect(onResolve).not.toHaveBeenCalled();
            expect(onReject).toHaveBeenCalled();
          });

          it('removes all listeners on all Scannables', async () => {   
            expect(storeA.listeners.size).toEqual(0);
            expect(storeB.listeners.size).toEqual(0);
          });
        });
      });
    });
  });
});