import { IsOptional, IsString, IsDateString, IsInt, Min, Max, IsUUID } from 'class-validator';

export class GetTraderPerformanceDto {
  @IsUUID()
  traderId: string;

  @IsDateString()
  dateFrom: string;

  @IsDateString()
  dateTo: string;
}

export class GetAllTradersPerformanceDto {
  @IsDateString()
  dateFrom: string;

  @IsDateString()
  dateTo: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;
}

export class GetUserRetentionDto {
  @IsDateString()
  dateFrom: string;

  @IsDateString()
  dateTo: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  intervalDays?: number = 30;
}

export class GetBehaviorPatternsDto {
  @IsUUID()
  traderId: string;

  @IsDateString()
  dateFrom: string;

  @IsDateString()
  dateTo: string;
}
