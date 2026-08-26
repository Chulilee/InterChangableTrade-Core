import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsEnum } from 'class-validator';

export enum PerformanceTimeFrame {
  ONE_DAY = '1D',
  ONE_MONTH = '1M',
  ONE_YEAR = '1Y',
  ALL_TIME = 'ALL',
}

export class PortfolioQueryDto {
  @ApiPropertyOptional({
    enum: PerformanceTimeFrame,
    description: 'Time frame for performance calculations',
  })
  @IsOptional()
  @IsEnum(PerformanceTimeFrame)
  timeFrame?: PerformanceTimeFrame = PerformanceTimeFrame.ALL_TIME;
}
