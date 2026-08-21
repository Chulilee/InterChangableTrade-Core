import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { KycDocumentType } from '../enums/kyc-document-type.enum';

/**
 * Request body for uploading a KYC document.
 */
export class UploadDocumentDto {
  @ApiProperty({ enum: KycDocumentType, description: 'Type of document' })
  @IsEnum(KycDocumentType)
  documentType: KycDocumentType;

  @ApiPropertyOptional({ description: 'Additional context for the document' })
  @IsOptional()
  @IsString()
  notes?: string;
}
