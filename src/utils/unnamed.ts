/**
 * Returns `fn` without a name inferred from the binding it is assigned to. A bundler that keeps
 * function names (esbuild `keepNames`) redefines `name` on each closure bound to a variable, which
 * moves the closure into a ~250 B property dictionary. Per-subscription closures use this to avoid it.
 */
export function unnamed<TFn extends (...args: any[]) => any>(fn: TFn): TFn {
  return fn;
}
