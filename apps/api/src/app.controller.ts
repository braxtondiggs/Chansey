import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';

import { Message } from '@chansey/api-interfaces';

import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('hello')
  @ApiExcludeEndpoint()
  getData(): Message {
    return this.appService.getData();
  }

  @Post('webhook/cca')
  async CCAWebhook(@Body() body: any) {
    console.log(body);
    return body;
  }
}
