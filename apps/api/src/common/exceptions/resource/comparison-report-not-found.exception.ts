import { NotFoundException } from '../base/not-found.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when a comparison report cannot be found.
 */
export class ComparisonReportNotFoundException extends NotFoundException {
  constructor(id: string) {
    super(`Comparison report with ID ${id} not found`, ErrorCode.NOT_FOUND_RESOURCE, {
      id,
      resourceType: 'ComparisonReport'
    });
  }
}
