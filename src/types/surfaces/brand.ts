export function brand<
  T extends 'Control' | 'Emitting' | 'Introspection' | 'Monitoring' | 'Subscription'
>(type: T): `@@Strongbus${T}Surface` {
  return `@@Strongbus${type}Surface`;
}