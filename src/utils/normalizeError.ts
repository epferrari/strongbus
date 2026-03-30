export function normalizeError(e: unknown): Error {
  return e instanceof Error
    ? e
    : typeof e === 'string'
      ? new Error(e)
      : typeof (e as any)?.message === 'string'
        ? new Error((e as any).message)
        : new Error();
}