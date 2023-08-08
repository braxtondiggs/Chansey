import { NotFoundException } from '@nestjs/common';

export class NotFoundCustomException extends NotFoundException {
  constructor(name: string, value: { [key: string]: string }) {
    super(`${name} with ${Object.keys(value)[0]} ${value} not found`);
  }
}
