export type PromiseCache<T> = {
  current?: Promise<T>;
};

export function getOrCreateRecoverablePromise<T>(
  cache: PromiseCache<T>,
  factory: () => Promise<T>,
): Promise<T> {
  if (cache.current) {
    return cache.current;
  }

  const pending = factory();
  cache.current = pending;

  void pending.catch(() => {
    if (cache.current === pending) {
      delete cache.current;
    }
  });

  return pending;
}
