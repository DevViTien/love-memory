export type Success<T> = Readonly<{
  data: T;
  ok: true;
}>;

export type Failure<E> = Readonly<{
  error: E;
  ok: false;
}>;

export type Result<T, E> = Success<T> | Failure<E>;

export function success<T>(data: T): Success<T> {
  return { data, ok: true };
}

export function failure<E>(error: E): Failure<E> {
  return { error, ok: false };
}

export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) {
    return result.data;
  }

  throw new Error("Cannot unwrap a failed result.");
}
