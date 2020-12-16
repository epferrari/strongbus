type Invocable = () => void;
export function over(iterable: Invocable[]|{values: () => IterableIterator<() => void>}): () => void {
  return () => {
    if(Array.isArray(iterable)) {
      for(const f of iterable) {
        f();
      }
    } else {
      for(const f of iterable.values()) {
        f();
      }
    }
  };
}