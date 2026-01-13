import { NotFoundException } from '../base/not-found.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when an algorithm cannot be found.
 */
export class AlgorithmNotFoundException extends NotFoundException {
  constructor(id: string) {
    super(`Algorithm with ID ${id} not found`, ErrorCode.NOT_FOUND_ALGORITHM, { id });
  }
}
