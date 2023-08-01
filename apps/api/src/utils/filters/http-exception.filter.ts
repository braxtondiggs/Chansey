import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const status = exception.getStatus();
    const errResponse = exception.getResponse() as { error: string; message: string; statusCode: number };
    const message = errResponse?.message || exception.message;

    response.status(status).send({
      error: errResponse?.error || exception.message,
      message,
      path: request.url,
      statusCode: status,
      timestamp: new Date().toISOString()
    });
  }
}
