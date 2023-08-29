import { NotFoundException } from '@nestjs/common';

export class NotFoundCustomException extends NotFoundException {
  constructor(name: string, value?: { [key: string]: string }) {
    if (typeof value === 'undefined') {
      super(`${name} not found`);
      return;
    }
    const query = [];
    Object.keys(value).forEach((key) => query.push(`${key}: ${value[key]}`));
    super(`${name} with ${query.join(', ')} not found`);
  }
}
