import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { ClsModule } from 'nestjs-cls';

import { randomUUID } from 'crypto';

import { ClsContextInterceptor } from './cls-context.interceptor';
import { CLS_IP_ADDRESS, CLS_REQUEST_ID, CLS_USER_AGENT } from './cls.constants';
import { RequestContext } from './request-context.service';

@Global()
@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        setup: (cls, req) => {
          cls.set(CLS_REQUEST_ID, req.id ?? randomUUID());
          cls.set(CLS_IP_ADDRESS, req.ip);
          cls.set(CLS_USER_AGENT, req.headers['user-agent']);
        }
      }
    })
  ],
  providers: [RequestContext, { provide: APP_INTERCEPTOR, useClass: ClsContextInterceptor }],
  exports: [RequestContext]
})
export class ClsContextModule {}
