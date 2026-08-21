import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  UploadedFile,
  UseInterceptors,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../auth/decorators/current-user.decorator';
import { UserRole } from '../users/entities/user.entity';
import { ComplianceService } from './compliance.service';
import { InitiateKycDto } from './dto/initiate-kyc.dto';
import { QueryKycDto } from './dto/query-kyc.dto';
import { UpdateKycLevelDto } from './dto/update-kyc-level.dto';
import { QueryAmlFlagDto } from './dto/query-aml-flag.dto';
import { ReviewAmlFlagDto } from './dto/review-aml-flag.dto';
import { AssessTransactionRiskDto } from './dto/assess-transaction-risk.dto';
import { UpsertComplianceConfigDto } from './dto/upsert-compliance-config.dto';
import { KycLevel } from './enums/kyc-level.enum';
import { KycDocumentStatus } from './enums/kyc-document-status.enum';

/**
 * KYC/AML compliance controller.
 *
 * Provides endpoints for:
 * - KYC verification workflows
 * - Document upload, retrieval, and review
 * - Risk assessment and scoring
 * - AML flag management and admin review
 * - Compliance configuration
 * - Audit trail access
 */
@ApiTags('compliance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('compliance')
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  // ─── KYC Verification ──────────────────────────────────────────────────

  @Post('kyc/verify')
  @ApiOperation({
    summary: 'Initiate KYC verification workflow',
    description:
      'Creates or retrieves a KYC verification record and begins the verification process for the authenticated user.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'KYC verification initiated successfully',
  })
  @HttpCode(HttpStatus.CREATED)
  async initiateVerification(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InitiateKycDto,
    @Req() req: Request,
  ) {
    const verification = await this.complianceService.initiateVerification(
      user.id,
      dto,
      user.id,
      user.role,
    );
    return { success: true, data: verification };
  }

  @Get('kyc/status')
  @ApiOperation({
    summary: 'Get user KYC verification status',
    description:
      'Returns the current KYC verification level and risk assessment for the authenticated user.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'KYC status retrieved',
  })
  async getStatus(@CurrentUser() user: AuthenticatedUser) {
    const verification =
      await this.complianceService.getVerificationStatus(user.id);
    return { success: true, data: verification };
  }

  @Get('kyc/status/:userId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({
    summary: 'Get KYC status for a specific user (admin/analyst)',
  })
  async getStatusByUserId(
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    const verification =
      await this.complianceService.getVerificationStatus(userId);
    return { success: true, data: verification };
  }

  @Get('kyc/list')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'List all KYC verifications (admin/analyst)' })
  async listVerifications(@Query() query: QueryKycDto) {
    const result = await this.complianceService.listVerifications(query);
    return { success: true, data: result };
  }

  @Put('kyc/level/:userId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Update user KYC level (admin only)',
    description:
      'Manually sets a user\'s KYC verification level and optionally blocks their transactions.',
  })
  async updateKycLevel(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { level: KycLevel } & UpdateKycLevelDto,
    @Req() req: Request,
  ) {
    const verification = await this.complianceService.updateKycLevel(
      userId,
      body.level,
      {
        notes: body.notes,
        transactionsBlocked: body.transactionsBlocked,
        blockReason: body.blockReason,
      },
      user.id,
      user.role,
    );
    return { success: true, data: verification };
  }

  // ─── Document Management ────────────────────────────────────────────────

  @Post('kyc/documents/upload')
  @ApiOperation({
    summary: 'Upload a KYC document',
    description:
      'Uploads a document for identity verification. Supported formats: PDF, JPEG, PNG, WebP. Max size: 10MB.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        documentType: {
          type: 'string',
          enum: ['id_verification', 'address_proof', 'beneficial_ownership'],
        },
        notes: { type: 'string' },
      },
      required: ['file', 'documentType'],
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  @HttpCode(HttpStatus.CREATED)
  async uploadDocument(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
    @Body('documentType') documentType: string,
    @Body('notes') notes?: string,
  ) {
    const document = await this.complianceService.uploadDocument(
      user.id,
      file,
      documentType as any,
      notes,
      user.id,
      user.role,
    );
    return { success: true, data: document };
  }

  @Get('kyc/documents')
  @ApiOperation({ summary: 'Get all KYC documents for the authenticated user' })
  async getDocuments(@CurrentUser() user: AuthenticatedUser) {
    const documents = await this.complianceService.getDocuments(user.id);
    return { success: true, data: documents };
  }

  @Get('kyc/documents/:documentId')
  @ApiOperation({ summary: 'Get a specific KYC document' })
  async getDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    const document = await this.complianceService.getDocument(documentId);
    return { success: true, data: document };
  }

  @Get('kyc/documents/:documentId/retrieve')
  @ApiOperation({
    summary: 'Retrieve a document for download',
    description:
      'Returns the encrypted storage reference for downloading a document.',
  })
  async retrieveDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    const result = await this.complianceService.retrieveDocument(
      documentId,
      user.id,
    );
    return { success: true, data: result };
  }

  @Put('kyc/documents/:documentId/review')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({
    summary: 'Review a KYC document (admin/analyst)',
    description: 'Verify or reject a submitted document.',
  })
  async reviewDocument(
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: {
      status: 'verified' | 'rejected';
      rejectionReason?: string;
    },
  ) {
    const document = await this.complianceService.reviewDocument(
      documentId,
      body.status as KycDocumentStatus.VERIFIED | KycDocumentStatus.REJECTED,
      user.id,
      user.role,
      body.rejectionReason,
    );
    return { success: true, data: document };
  }

  // ─── Risk Assessment ────────────────────────────────────────────────────

  @Get('risk/score')
  @ApiOperation({
    summary: 'Calculate risk score for the authenticated user',
    description:
      'Returns a composite risk score (0-100) and risk level based on multiple factors.',
  })
  async getRiskScore(@CurrentUser() user: AuthenticatedUser) {
    const result = await this.complianceService.calculateRiskScore(user.id);
    return { success: true, data: result };
  }

  @Post('risk/assess-transaction')
  @ApiOperation({
    summary: 'Assess risk for a specific transaction',
    description:
      'Evaluates a transaction against AML rules and returns a risk assessment. May create an AML flag if suspicious patterns are detected.',
  })
  @HttpCode(HttpStatus.OK)
  async assessTransactionRisk(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AssessTransactionRiskDto,
    @Req() req: Request,
  ) {
    const ipAddress =
      (req.headers['x-forwarded-for'] as string) ??
      req.socket.remoteAddress ??
      undefined;
    const result = await this.complianceService.assessTransactionRisk(
      user.id,
      dto,
      user.id,
      user.role,
    );
    return { success: true, data: result };
  }

  @Put('risk/refresh/:userId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Refresh risk assessment for a user (admin)',
    description:
      'Recalculates the risk score based on current data and updates the user record.',
  })
  async refreshRiskAssessment(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const verification =
      await this.complianceService.updateRiskAssessment(userId);
    return { success: true, data: verification };
  }

  @Get('risk/check-transaction-block/:userId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Check if a user has blocked transactions' })
  async checkTransactionBlock(
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    const blocked =
      await this.complianceService.shouldBlockTransactions(userId);
    return { success: true, data: { blocked } };
  }

  // ─── AML Flags ──────────────────────────────────────────────────────────

  @Get('aml/flags')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({
    summary: 'List AML flags (admin/analyst)',
    description:
      'Returns a paginated list of AML flags with optional filtering.',
  })
  async listFlags(@Query() query: QueryAmlFlagDto) {
    const result = await this.complianceService.listFlags(query);
    return { success: true, data: result };
  }

  @Get('aml/flags/:flagId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Get a specific AML flag' })
  async getFlag(@Param('flagId', ParseUUIDPipe) flagId: string) {
    const flag = await this.complianceService.getFlag(flagId);
    return { success: true, data: flag };
  }

  @Put('aml/flags/:flagId/review')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Review and resolve an AML flag (admin only)',
    description:
      'Reviews a flagged transaction/activity and sets the resolution status. Supports filing a Suspicious Activity Report (SAR).',
  })
  async reviewFlag(
    @Param('flagId', ParseUUIDPipe) flagId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReviewAmlFlagDto,
    @Req() req: Request,
  ) {
    const ipAddress =
      (req.headers['x-forwarded-for'] as string) ??
      req.socket.remoteAddress ??
      undefined;
    const flag = await this.complianceService.reviewFlag(
      flagId,
      user.id,
      user.role,
      dto,
      ipAddress,
    );
    return { success: true, data: flag };
  }

  // ─── Compliance Configuration ───────────────────────────────────────────

  @Get('config')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'List all compliance configurations (admin)' })
  async listConfigs() {
    const configs = await this.complianceService.listConfigs();
    return { success: true, data: configs };
  }

  @Get('config/:region')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Get compliance configuration for a region (admin)',
  })
  async getConfig(@Param('region') region: string) {
    const config = await this.complianceService.getConfigForRegion(region);
    return { success: true, data: config };
  }

  @Put('config')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Create or update compliance configuration (admin)',
    description:
      'Sets compliance thresholds and rules for a specific region.',
  })
  async upsertConfig(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpsertComplianceConfigDto,
  ) {
    const config = await this.complianceService.upsertConfig(
      dto as Partial<UpsertComplianceConfigDto>,
      user.id,
      user.role,
    );
    return { success: true, data: config };
  }

  // ─── Audit Trail ────────────────────────────────────────────────────────

  @Get('audit')
  @ApiOperation({
    summary: 'Get audit trail for the authenticated user',
  })
  async getAuditTrail(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const result = await this.complianceService.getAuditTrail(
      user.id,
      page ?? 1,
      limit ?? 20,
    );
    return { success: true, data: result };
  }

  @Get('audit/all')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Get all compliance audit logs (admin)',
    description:
      'Returns the complete audit trail for compliance actions across all users.',
  })
  async getAllAuditLogs(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const result = await this.complianceService.getAllAuditLogs(
      page ?? 1,
      limit ?? 20,
    );
    return { success: true, data: result };
  }
}
