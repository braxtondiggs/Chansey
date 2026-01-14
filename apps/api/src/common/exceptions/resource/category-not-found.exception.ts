import { NotFoundException } from '../base/not-found.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when a category cannot be found.
 */
export class CategoryNotFoundException extends NotFoundException {
  constructor(id: string) {
    super(`Category with ID ${id} not found`, ErrorCode.NOT_FOUND_CATEGORY, { id });
  }
}
