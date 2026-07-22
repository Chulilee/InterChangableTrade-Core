import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, Matches } from 'class-validator';

/**
 * Request to invoke a read-only Soroban contract method. Arguments are passed
 * as strings and marshaled by the service; write/signed invocations are out of
 * scope for the MVP.
 */
export class InvokeContractDto {
  @ApiProperty({ description: 'Soroban contract id (starts with C)' })
  @IsString()
  @Matches(/^C[A-Z2-7]{55}$/, {
    message: 'contractId must be a valid Soroban contract id',
  })
  contractId: string;

  @ApiProperty({ description: 'Contract method name to invoke' })
  @IsString()
  method: string;

  @ApiPropertyOptional({
    description: 'Positional string arguments for the method',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  args?: string[];
}
