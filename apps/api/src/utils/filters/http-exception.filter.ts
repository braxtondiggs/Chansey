import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { MESSAGES } from '@nestjs/core/constants';

import { FastifyReply, FastifyRequest } from 'fastify';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    if (!(exception instanceof HttpException)) return this.handleUnknownError(exception, host);

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const status = exception.getStatus();

    response.status(status).send({
      message: exception.message,
      path: request.url,
      statusCode: status,
      timestamp: new Date().toISOString()
    });
  }

  private handleUnknownError(_exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      message: MESSAGES.UNKNOWN_EXCEPTION_MESSAGE,
      path: request.url,
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      timestamp: new Date().toISOString()
    });
  }
}
