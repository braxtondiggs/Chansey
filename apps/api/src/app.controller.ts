import { Controller, Get } from '@nestjs/common';

import { Message } from '@chansey/api-interfaces';

import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) { }

  @Get()
  getData2(): Message {
    return this.appService.getData();
  }

  @Get('hello')
  getData(): Message {
    return this.appService.getData();
  }
}
