import { ApiProperty } from '@nestjs/swagger';
import { IsDateString } from 'class-validator';

export class CalculateMetricsDto {
  @ApiProperty({
    description: 'Start of the calculation window (inclusive), ISO 8601',
    example: '2026-01-01T00:00:00.000Z',
  })
  @IsDateString()
  dateFrom: string;

  @ApiProperty({
    description: 'End of the calculation window (inclusive), ISO 8601',
    example: '2026-01-31T23:59:59.999Z',
  })
  @IsDateString()
  dateTo: string;
}
