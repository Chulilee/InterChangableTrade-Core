import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateApiKeyDto {
  @ApiProperty({ description: 'Human-readable label for the key', example: 'CI Pipeline Key' })
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  name: string;

  @ApiPropertyOptional({
    description: 'ISO 8601 expiry date. Omit for a non-expiring key.',
    example: '2027-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({
    description: 'Scope restrictions for this key. Omit to inherit all user scopes.',
    example: ['assets:read', 'orders:write'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  scopes?: string[];
}
