export function randomId(): string {
  return Math.random().toString(16).substring(2, 15) + Math.random().toString(16).substring(2, 15);
}