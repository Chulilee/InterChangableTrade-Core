import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpStatus,
  HttpCode,
  ParseUUIDPipe,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
import { DisputeResolutionService } from './dispute-resolution.service';
import { DisputeAnalyticsService } from './services/dispute-analytics.service';
import { ArbitratorService } from './services/arbitrator.service';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { QueryDisputeDto } from './dto/query-dispute.dto';
import { SubmitEvidenceDto } from './dto/submit-evidence.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { AppealDisputeDto } from './dto/appeal-dispute.dto';
import { CreateArbitratorDto } from './dto/create-arbitrator.dto';
import { Dispute } from './entities/dispute.entity';
import { PaginatedResultDto } from '@app/common';
import { UploadedFilePayload } from './types/uploaded-file.type';

@ApiTags('dispute-resolution')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('disputes')
export class DisputeResolutionController {
  constructor(
    private readonly disputeService: DisputeResolutionService,
    private readonly analyticsService: DisputeAnalyticsService,
    private readonly arbitratorService: ArbitratorService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new dispute' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Dispute created successfully',
    type: Dispute,
  })
  @HttpCode(HttpStatus.CREATED)
  async createDispute(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDisputeDto,
  ): Promise<Dispute> {
    return this.disputeService.createDispute(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List disputes with filtering and pagination' })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryDisputeDto,
  ): Promise<PaginatedResultDto<Dispute>> {
    return this.disputeService.findAll(user.id, user.role, query);
  }

  @Get('analytics/dashboard')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'Get dispute metrics and trends dashboard' })
  async getAnalyticsDashboard() {
    return this.analyticsService.getDashboardMetrics();
  }

  @Post('arbitrators')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Register a user as an arbitrator' })
  async createArbitrator(@Body() dto: CreateArbitratorDto) {
    return this.arbitratorService.createArbitrator(dto);
  }

  @Get('arbitrators')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  @ApiOperation({ summary: 'List all arbitrators' })
  async listArbitrators() {
    return this.arbitratorService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get dispute status and details' })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.disputeService.findOne(id, user.id, user.role);
  }

  @Post(':id/evidence')
  @ApiOperation({ summary: 'Upload evidence for a dispute' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        description: { type: 'string' },
      },
      required: ['file'],
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async submitEvidence(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedFilePayload,
    @Body() dto: SubmitEvidenceDto,
  ) {
    if (!file) {
      throw new BadRequestException('Evidence file is required');
    }
    return this.disputeService.submitEvidence(
      id,
      user.id,
      user.role,
      file,
      dto.description,
    );
  }

  @Post(':id/messages')
  @ApiOperation({
    summary: 'Send a message in the dispute communication channel',
  })
  async sendMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateMessageDto,
  ) {
    return this.disputeService.sendMessage(id, user.id, user.role, dto);
  }

  @Post(':id/resolve')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ARBITRATOR)
  @ApiOperation({ summary: 'Resolve a dispute with a decision' })
  async resolveDispute(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveDisputeDto,
  ) {
    return this.disputeService.resolveDispute(id, user.id, user.role, dto);
  }

  @Post(':id/appeal')
  @ApiOperation({
    summary: 'File an appeal on a resolved dispute (one per dispute)',
  })
  async appealDispute(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AppealDisputeDto,
  ) {
    return this.disputeService.appealDispute(id, user.id, dto);
  }

  @Get(':id/timeline')
  @ApiOperation({ summary: 'Get dispute timeline events' })
  async getTimeline(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.disputeService.getTimeline(id, user.id, user.role);
  }
}
