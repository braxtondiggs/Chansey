import { CACHE_TTL_METADATA } from '@nestjs/cache-manager';
import { SetMetadata, ExecutionContext } from '@nestjs/common';

// export const CACHE_KEY_METADATA = 'cache_key_factory';

export const UseCacheKey = (factory: (ctx: ExecutionContext) => string): MethodDecorator => {
  return SetMetadata(CACHE_TTL_METADATA, factory);
};
