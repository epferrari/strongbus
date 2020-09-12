export function over(fns: (() => any)[]): () => void {
  return () => {
    fns.forEach(fn => fn());
  };
}