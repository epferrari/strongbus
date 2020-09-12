export function compact<T>(arr: T[]): T[] {
  if(!arr) {
    return [];
  }
  return arr.filter(el => Boolean(el));
}