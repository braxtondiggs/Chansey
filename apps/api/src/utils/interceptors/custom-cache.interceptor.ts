import { CACHE_KEY_METADATA, CACHE_MANAGER, CACHE_TTL_METADATA } from '@nestjs/cache-manager';
import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  NestInterceptor,
  Optional,
  StreamableFile
} from '@nestjs/common';
import { isFunction, isNil } from '@nestjs/common/utils/shared.utils';
import { HttpAdapterHost, Reflector } from '@nestjs/core';

import { Cache } from 'cache-manager';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';

/**
 * @see [Caching](https://docs.nestjs.com/techniques/caching)
 *
 * @publicApi
 */
@Injectable()
export class CustomCacheInterceptor implements NestInterceptor {
  @Optional()
  @Inject()
  protected readonly httpAdapterHost: HttpAdapterHost;

  protected allowedMethods = ['GET'];

  constructor(
    @Inject(CACHE_MANAGER) protected readonly cacheManager: Cache,
    protected readonly reflector: Reflector
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const key = this.trackBy(context);
    const ttlValueOrFactory =
      this.reflector.get(CACHE_TTL_METADATA, context.getHandler()) ??
      this.reflector.get(CACHE_TTL_METADATA, context.getClass()) ??
      null;

    if (!key) {
      return next.handle();
    }
    try {
      const value = await this.cacheManager.get(key);
      this.setHeadersWhenHttp(context, value);

      // Enhanced cache logging
      const handler = context.getHandler();
      const controllerName = context.getClass().name;
      const handlerName = handler.name;

      if (!isNil(value)) {
        Logger.log(`Cache HIT for ${controllerName}.${handlerName} with key: ${key}`, 'CacheInterceptor');
        return of(value);
      }

      Logger.log(`Cache MISS for ${controllerName}.${handlerName} with key: ${key}`, 'CacheInterceptor');
      const ttl = isFunction(ttlValueOrFactory) ? await ttlValueOrFactory(context) : ttlValueOrFactory;
      Logger.log(`Using TTL: ${ttl}`, 'CacheInterceptor');

      return next.handle().pipe(
        tap(async (response) => {
          if (response instanceof StreamableFile) {
            return;
          }

          try {
            if (!isNil(ttl)) {
              await this.cacheManager.set(key, response, ttl);
              Logger.log(`Caching result with key: ${key} for ${ttl} seconds`, 'CacheInterceptor');
            } else {
              await this.cacheManager.set(key, response);
              Logger.log(`Caching result with key: ${key} (no TTL specified)`, 'CacheInterceptor');
            }
          } catch (err) {
            Logger.error(
              `An error has occurred when inserting "key: ${key}", "value: ${JSON.stringify(response).substring(0, 100) + '...'}"`,
              err.stack,
              'CacheInterceptor'
            );
          }
        })
      );
    } catch {
      return next.handle();
    }
  }

  protected trackBy(context: ExecutionContext): string | undefined {
    const httpAdapter = this.httpAdapterHost.httpAdapter;
    const isHttpApp = httpAdapter && !!httpAdapter.getRequestMethod;
    const cacheKeyFactory = this.reflector.get(CACHE_KEY_METADATA, context.getHandler());

    if (!isHttpApp) {
      return undefined;
    }

    // If we have a custom cache key factory, use it
    if (cacheKeyFactory && isFunction(cacheKeyFactory)) {
      return cacheKeyFactory(context);
    }

    const request = context.getArgByIndex(0);
    if (!this.isRequestCacheable(context)) {
      return undefined;
    }
    return httpAdapter.getRequestUrl(request);
  }

  protected isRequestCacheable(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    return this.allowedMethods.includes(req.method);
  }

  protected setHeadersWhenHttp(context: ExecutionContext, value: unknown): void {
    if (!this.httpAdapterHost) {
      return;
    }
    const { httpAdapter } = this.httpAdapterHost;
    if (!httpAdapter) {
      return;
    }
    const response = context.switchToHttp().getResponse();
    httpAdapter.setHeader(response, 'X-Cache', isNil(value) ? 'MISS' : 'HIT');
  }
}
