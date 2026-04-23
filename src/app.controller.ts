import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('healthz')
  getHealth(): { ok: true } {
    return { ok: true };
  }

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
