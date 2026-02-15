/**
 * Safely extract message and stack from an unknown caught value.
 * Use in catch blocks: `const err = toErrorInfo(error);`
 */
export function toErrorInfo(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}
