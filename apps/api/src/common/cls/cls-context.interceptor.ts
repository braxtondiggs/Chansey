import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';

import { FastifyRequest } from 'fastify';
import { Observable } from 'rxjs';

import { RequestContext } from './request-context.service';

/**
 * Populates CLS context with the authenticated user's ID.
 *
 * **Execution order matters:**
 * 1. ClsMiddleware runs first — sets requestId, ipAddress, userAgent.
 * 2. Guards run next (e.g., JwtAuthGuard) — attach `request.user`.
 *    If the guard rejects (401), this interceptor never runs, so userId
 *    will be undefined in CLS. GlobalExceptionFilter still has requestId,
 *    ipAddress, and userAgent from step 1.
 * 3. This interceptor runs — copies `request.user.id` into CLS.
 */
@Injectable()
export class ClsContextInterceptor implements NestInterceptor {
  constructor(private readonly requestContext: RequestContext) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const user = (request as FastifyRequest & { user?: { id: string } }).user;

    if (user) {
      this.requestContext.userId = user.id;
    }

    return next.handle();
  }
}
