/**
 * Races a promise against a timeout. Rejects with a descriptive error if the
 * promise does not settle within `ms` milliseconds. The timeout is cleared in
 * `finally` to avoid dangling timers when the promise settles first.
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
