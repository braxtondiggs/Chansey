/**
 * Standardized API error response format from the backend.
 */
export interface ApiErrorResponse {
  /** HTTP status code */
  statusCode: number;
  /** Machine-readable error code for programmatic handling */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Request path that caused the error */
  path: string;
  /** Timestamp when the error occurred */
  timestamp: string;
  /** Additional context about the error */
  context?: Record<string, unknown>;
}

/**
 * Custom error class that preserves the full API error response.
 */
export class ApiError extends Error {
  /** HTTP status code */
  readonly statusCode: number;
  /** Machine-readable error code */
  readonly code: string;
  /** Request path that caused the error */
  readonly path?: string;
  /** Timestamp when the error occurred */
  readonly timestamp?: string;
  /** Additional context about the error */
  readonly context?: Record<string, unknown>;

  constructor(response: Partial<ApiErrorResponse>) {
    super(response.message || 'An error occurred');
    this.name = 'ApiError';
    this.statusCode = response.statusCode || 500;
    this.code = response.code || 'INTERNAL.UNEXPECTED_ERROR';
    this.path = response.path;
    this.timestamp = response.timestamp;
    this.context = response.context;
  }

  /**
   * Check if the error matches a specific error code.
   */
  hasCode(code: string): boolean {
    return this.code === code;
  }

  /**
   * Check if the error code starts with a given prefix.
   */
  hasCodePrefix(prefix: string): boolean {
    return this.code.startsWith(prefix);
  }
}

/**
 * Common error codes from the backend.
 * These match the ErrorCode enum in the API.
 */
export const ErrorCodes = {
  // Authentication
  AUTH_INVALID_CREDENTIALS: 'AUTH.INVALID_CREDENTIALS',
  AUTH_TOKEN_EXPIRED: 'AUTH.TOKEN_EXPIRED',
  AUTH_TOKEN_INVALID: 'AUTH.TOKEN_INVALID',
  AUTH_EMAIL_NOT_VERIFIED: 'AUTH.EMAIL_NOT_VERIFIED',
  AUTH_ACCOUNT_LOCKED: 'AUTH.ACCOUNT_LOCKED',
  AUTH_TOO_MANY_ATTEMPTS: 'AUTH.TOO_MANY_ATTEMPTS',
  AUTH_EMAIL_ALREADY_EXISTS: 'AUTH.EMAIL_ALREADY_EXISTS',
  AUTH_INVALID_OTP: 'AUTH.INVALID_OTP',
  AUTH_OTP_EXPIRED: 'AUTH.OTP_EXPIRED',
  AUTH_PASSWORD_MISMATCH: 'AUTH.PASSWORD_MISMATCH',

  // Not Found
  NOT_FOUND_USER: 'NOT_FOUND.USER',
  NOT_FOUND_ORDER: 'NOT_FOUND.ORDER',
  NOT_FOUND_COIN: 'NOT_FOUND.COIN',
  NOT_FOUND_EXCHANGE: 'NOT_FOUND.EXCHANGE',
  NOT_FOUND_EXCHANGE_KEY: 'NOT_FOUND.EXCHANGE_KEY',
  NOT_FOUND_RESOURCE: 'NOT_FOUND.RESOURCE',

  // Business Rules
  BUSINESS_INSUFFICIENT_BALANCE: 'BUSINESS.INSUFFICIENT_BALANCE',
  BUSINESS_ORDER_CANNOT_CANCEL: 'BUSINESS.ORDER_CANNOT_CANCEL',
  BUSINESS_TRADING_SUSPENDED: 'BUSINESS.TRADING_SUSPENDED',
  BUSINESS_INVALID_SYMBOL: 'BUSINESS.INVALID_SYMBOL',

  // Validation
  VALIDATION_INVALID_INPUT: 'VALIDATION.INVALID_INPUT'
} as const;

/**
 * Type-safe helper to check if an error is an ApiError.
 */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/**
 * Extract error information from any error type.
 * Works with both ApiError and regular Error objects.
 */
export function extractErrorInfo(error: unknown): { code: string; message: string } {
  if (error instanceof ApiError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return { code: 'UNKNOWN_ERROR', message: error.message };
  }
  return { code: 'UNKNOWN_ERROR', message: 'An unexpected error occurred' };
}
