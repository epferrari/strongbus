export function brand<T extends 'Control'|'Introspection'|'Monitoring'|'Subscription'>(type: T): `@@Strongbus${T}Surface` {
  return `@@Strongbus${type}Surface`;
}