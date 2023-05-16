const {gc} = global;

// If more than 1024kb of heap are created during the function execution, error
const defaultCutoffBytes: number = Math.pow(2, 20);

export async function testForMemoryLeak(fn: () => (void | Promise<void>), cutoffBytes: number = defaultCutoffBytes) {
  if(!gc) {
    throw new Error('Memory leak node tests require "node --expose-gc" flag');
  }

  // Take baseline memory snapshot
  gc();
  const memStart = getHeapSize();

  await fn();

  // Take final memory snapshot
  gc();
  const memEnd = getHeapSize();

  if(memEnd - memStart > cutoffBytes) {
    const heapChange = memEnd - memStart;
    throw new Error(`Memory leak detected: heap grew by ${bytes(heapChange)}`);
  }
}

function getHeapSize(): number {
  return process.memoryUsage().heapUsed;
}

function bytes(bytes: number): string {
  const mb = Math.pow(2, 20);
  return `${(bytes / mb).toFixed(2)}mb`
}