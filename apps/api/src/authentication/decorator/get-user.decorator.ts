import { ExecutionContext, createParamDecorator } from '@nestjs/common';

const GetUser = createParamDecorator((data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});

export default GetUser;
