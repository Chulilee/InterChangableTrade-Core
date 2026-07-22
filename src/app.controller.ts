import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';
import { ResilienceService } from './modules/resilience/resilience.service';

@ApiTags('health')
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly resilienceService: ResilienceService,
  ) {}

  @Get()
  async getRoot(): Promise<{ name: string; status: string }> {
    return this.resilienceService.resilientPipeline.execute(async () =>
      this.appService.getInfo(),
    );
  }

  @Get('health')
  getHealth(): { status: string; timestamp: string } {
    return this.appService.getHealth();
  }
}
