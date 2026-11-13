import * as v8 from 'v8';
import * as vm from 'vm';

v8.setFlagsFromString('--allow-natives-syntax');

/** Whether V8 gave both objects the same hidden class, which keeps property access on them monomorphic. */
export const haveSameHiddenClass: (a: object, b: object) => boolean =
  vm.runInNewContext('(a, b) => %HaveSameMap(a, b)');
