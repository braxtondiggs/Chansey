// Error types for classification
export class RecoverableError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'RecoverableError';
  }
}

export class UnrecoverableError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'UnrecoverableError';
  }
}

/**
 * Classify an error and wrap it in the appropriate error class.
 * Returns a RecoverableError or UnrecoverableError based on error characteristics.
 */
export function classifyError(error: Error): RecoverableError | UnrecoverableError {
  const errorMessage = error.message?.toLowerCase() ?? '';
  const errorName = error.name?.toLowerCase() ?? '';

  // Configuration and authentication errors are unrecoverable
  if (
    errorMessage.includes('invalid api key') ||
    errorMessage.includes('authentication') ||
    errorMessage.includes('unauthorized') ||
    errorMessage.includes('forbidden') ||
    errorMessage.includes('401') ||
    errorMessage.includes('403') ||
    errorMessage.includes('not found') ||
    errorMessage.includes('algorithm') ||
    errorMessage.includes('configuration') ||
    errorMessage.includes('invalid parameter')
  ) {
    return new UnrecoverableError(error.message, error);
  }

  // Network and rate limit errors are recoverable
  if (
    errorName.includes('network') ||
    errorName.includes('timeout') ||
    errorMessage.includes('network') ||
    errorMessage.includes('timeout') ||
    errorMessage.includes('econnrefused') ||
    errorMessage.includes('enotfound') ||
    errorMessage.includes('rate limit') ||
    errorMessage.includes('too many requests') ||
    errorMessage.includes('429') ||
    errorMessage.includes('503') ||
    errorMessage.includes('502') ||
    errorMessage.includes('temporarily unavailable')
  ) {
    return new RecoverableError(error.message, error);
  }

  // Default to recoverable for unknown errors
  return new RecoverableError(error.message, error);
}
