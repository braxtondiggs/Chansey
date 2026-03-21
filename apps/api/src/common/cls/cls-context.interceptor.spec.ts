import { CallHandler, ExecutionContext } from '@nestjs/common';

import { of } from 'rxjs';

import { ClsContextInterceptor } from './cls-context.interceptor';
import { RequestContext } from './request-context.service';

describe('ClsContextInterceptor', () => {
  let interceptor: ClsContextInterceptor;
  let requestContext: RequestContext;
  let next: CallHandler;

  beforeEach(() => {
    requestContext = {
      userId: undefined,
      requestId: undefined,
      ipAddress: undefined,
      userAgent: undefined
    } as any as RequestContext;

    interceptor = new ClsContextInterceptor(requestContext);
    next = { handle: jest.fn().mockReturnValue(of('result')) };
  });

  const createExecutionContext = (user?: { id: string }): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user })
      })
    }) as unknown as ExecutionContext;

  it('sets userId and forwards the response observable for authenticated requests', () => {
    const ctx = createExecutionContext({ id: 'user-123' });

    const result$ = interceptor.intercept(ctx, next);

    expect(requestContext.userId).toBe('user-123');
    expect(next.handle).toHaveBeenCalledTimes(1);
    expect(result$).toBeDefined();
  });

  it('skips userId assignment for unauthenticated requests', () => {
    const setUserIdSpy = jest.fn();
    Object.defineProperty(requestContext, 'userId', { set: setUserIdSpy, configurable: true });
    const ctx = createExecutionContext(undefined);

    interceptor.intercept(ctx, next);

    expect(setUserIdSpy).not.toHaveBeenCalled();
    expect(next.handle).toHaveBeenCalledTimes(1);
  });
});
