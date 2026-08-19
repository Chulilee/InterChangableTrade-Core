import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';
import { GenerateReportDto } from './dto/generate-report.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';

/**
 * Read-only, admin-scoped surface over the audit trail. There is intentionally
 * no create/update/delete endpoint — audit records are written only by the
 * global {@link AuditInterceptor} and are immutable thereafter.
 */
@ApiTags('audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('logs')
  @ApiOperation({
    summary:
      'Search audit logs (paginated, filterable by user/action/date/resource)',
  })
  findAll(@Query() query: QueryAuditLogDto) {
    return this.auditService.findAll(query);
  }

  @Get('dashboard/activities')
  @ApiOperation({
    summary: 'Most recent activities for the security dashboard',
  })
  recentActivities() {
    return this.auditService.recentActivities(100);
  }

  @Get('export/:userId')
  @ApiOperation({
    summary: 'GDPR export: all audit records referencing a user',
  })
  exportForUser(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.auditService.exportForUser(userId);
  }

  @Get('logs/:id')
  @ApiOperation({ summary: 'Fetch a single audit record' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.auditService.findOne(id);
  }

  @Post('reports')
  @ApiOperation({
    summary: 'Generate a compliance report (CSV/PDF/JSON) and download it',
  })
  @ApiOkResponse({
    description: 'The generated report as a downloadable file',
  })
  async generateReport(
    @Body() dto: GenerateReportDto,
    @Res() res: Response,
  ): Promise<void> {
    const report = await this.auditService.generateReport(dto);
    res.setHeader('Content-Type', report.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${report.filename}"`,
    );
    res.send(report.content);
  }
}
