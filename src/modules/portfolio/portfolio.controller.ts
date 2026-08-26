import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PortfolioService } from './portfolio.service';
import { PortfolioQueryDto } from './dto/portfolio-query.dto';

@ApiTags('portfolio')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('portfolio')
export class PortfolioController {
  constructor(private readonly portfolioService: PortfolioService) {}

  @Get('dashboard')
  @ApiOperation({
    summary: "Get the authenticated user's portfolio dashboard",
    description:
      'Returns holdings, performance metrics, allocation breakdown, and summary for the authenticated user.',
  })
  getDashboard(
    @CurrentUser('id') userId: string,
    @Query() query: PortfolioQueryDto,
  ) {
    return this.portfolioService.getDashboard(userId, query.timeFrame);
  }

  @Post('snapshots')
  @ApiOperation({
    summary: 'Create a portfolio snapshot for historical tracking',
    description:
      'Captures a point-in-time snapshot of the portfolio for later performance comparison.',
  })
  createSnapshot(@CurrentUser('id') userId: string) {
    return this.portfolioService.createSnapshot(userId);
  }

  @Get('snapshots')
  @ApiOperation({
    summary: 'Get historical portfolio snapshots',
    description:
      'Returns historical portfolio snapshots within the specified time frame.',
  })
  getSnapshots(
    @CurrentUser('id') userId: string,
    @Query() query: PortfolioQueryDto,
  ) {
    return this.portfolioService.getSnapshots(userId, query.timeFrame!);
  }
}
