import { Injectable } from '@nestjs/common';

import { ClsService } from 'nestjs-cls';

import { CLS_IP_ADDRESS, CLS_REQUEST_ID, CLS_USER_AGENT, CLS_USER_ID } from './cls.constants';

@Injectable()
export class RequestContext {
  constructor(private readonly cls: ClsService) {}

  get userId(): string | undefined {
    return this.cls.isActive() ? this.cls.get(CLS_USER_ID) : undefined;
  }

  set userId(value: string) {
    this.cls.set(CLS_USER_ID, value);
  }

  get requestId(): string | undefined {
    return this.cls.isActive() ? this.cls.get(CLS_REQUEST_ID) : undefined;
  }

  set requestId(value: string) {
    this.cls.set(CLS_REQUEST_ID, value);
  }

  get ipAddress(): string | undefined {
    return this.cls.isActive() ? this.cls.get(CLS_IP_ADDRESS) : undefined;
  }

  set ipAddress(value: string) {
    this.cls.set(CLS_IP_ADDRESS, value);
  }

  get userAgent(): string | undefined {
    return this.cls.isActive() ? this.cls.get(CLS_USER_AGENT) : undefined;
  }

  set userAgent(value: string) {
    this.cls.set(CLS_USER_AGENT, value);
  }
}
