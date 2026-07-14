import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';

@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getRoot(): { name: string; status: string } {
    return this.appService.getInfo();
  }

  @Get('health')
  getHealth(): { status: string; timestamp: string } {
    return this.appService.getHealth();
  }
}
