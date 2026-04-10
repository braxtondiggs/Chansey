import { BadRequestException, InternalServerErrorException, type Logger } from '@nestjs/common';

import { NotFoundException } from '../../common/exceptions';
import { toErrorInfo } from '../../shared/error.util';

/**
 * Wraps an async operation, rethrowing NotFoundException/BadRequestException as-is and
 * logging + converting any other thrown error into an InternalServerErrorException.
 */
export function wrapInternal<T>(logger: Logger, label: string, fn: () => Promise<T>): Promise<T> {
  return fn().catch((error: unknown) => {
    if (error instanceof NotFoundException || error instanceof BadRequestException) {
      throw error;
    }
    const err = toErrorInfo(error);
    logger.error(`${label}: ${err.message}`, err.stack);
    throw new InternalServerErrorException(`${label} due to an internal error`);
  });
}
