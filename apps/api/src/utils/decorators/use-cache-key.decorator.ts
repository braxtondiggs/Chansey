import { CACHE_KEY_METADATA } from '@nestjs/cache-manager';
import { SetMetadata, ExecutionContext } from '@nestjs/common';

export const UseCacheKey = (factory: (ctx: ExecutionContext) => string): MethodDecorator => {
  return SetMetadata(CACHE_KEY_METADATA, factory);
};
