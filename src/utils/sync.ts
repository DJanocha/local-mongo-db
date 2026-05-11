export type MightFailSyncResult<T> =
  | { result: T; error?: undefined }
  | { result?: undefined; error: unknown };

export function mightFailSync<T>(fn: () => T): MightFailSyncResult<T> {
  try {
    return { result: fn() };
  } catch (error) {
    return { error };
  }
}
