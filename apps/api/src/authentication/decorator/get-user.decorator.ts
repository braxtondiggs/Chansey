import { type ExecutionContext, createParamDecorator } from '@nestjs/common';

const GetUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});

export default GetUser;
