
export function over(iterable: {values: () => IterableIterator<() => void>}): () => void {
  return () => {
    for(const f of iterable.values()) {
      f();
    }
  };
}