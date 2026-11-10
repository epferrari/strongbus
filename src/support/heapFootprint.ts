import * as v8 from 'v8';
import * as vm from 'vm';

v8.setFlagsFromString('--expose-gc');
const collectGarbage: () => void = vm.runInNewContext('gc');

function measureOnce(create: () => unknown, count: number): number {
  collectGarbage();
  const before = process.memoryUsage().heapUsed;
  const kept = Array.from({length: count}, create);
  collectGarbage();
  return (process.memoryUsage().heapUsed - before) / kept.length;
}

/** Median over several rounds of the heap bytes `create`'s result retains, per call, after a forced GC. */
export function bytesRetainedPer(create: () => unknown, {count = 2000, rounds = 5} = {}): number {
  const samples = Array.from({length: rounds}, () => measureOnce(create, count));
  return samples.sort((a, b) => a - b)[Math.floor(rounds / 2)];
}
