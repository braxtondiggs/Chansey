import { QueryFailedError } from 'typeorm';

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

/**
 * Check whether an unknown caught value is a PostgreSQL unique-constraint
 * violation (error code 23505) surfaced through TypeORM's QueryFailedError.
 */
export function isUniqueConstraintViolation(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driver = error.driverError as { code?: string };
  return driver.code === '23505';
}
