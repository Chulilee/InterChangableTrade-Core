import { Test, TestingModule } from '@nestjs/testing';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';
import {
  ComplianceReportType,
  GenerateReportDto,
  ReportFormat,
} from './dto/generate-report.dto';

describe('AuditController', () => {
  let controller: AuditController;
  let service: {
    findAll: jest.Mock;
    findOne: jest.Mock;
    recentActivities: jest.Mock;
    exportForUser: jest.Mock;
    generateReport: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      findAll: jest.fn(),
      findOne: jest.fn(),
      recentActivities: jest.fn(),
      exportForUser: jest.fn(),
      generateReport: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [{ provide: AuditService, useValue: service }],
    }).compile();

    controller = module.get(AuditController);
  });

  it('delegates log search to the service', () => {
    const query = { page: 1, limit: 20 } as QueryAuditLogDto;
    controller.findAll(query);
    expect(service.findAll).toHaveBeenCalledWith(query);
  });

  it('requests the last 100 activities for the dashboard', () => {
    controller.recentActivities();
    expect(service.recentActivities).toHaveBeenCalledWith(100);
  });

  it('delegates a GDPR export to the service', () => {
    controller.exportForUser('user-1');
    expect(service.exportForUser).toHaveBeenCalledWith('user-1');
  });

  it('fetches a single record by id', () => {
    controller.findOne('log-1');
    expect(service.findOne).toHaveBeenCalledWith('log-1');
  });

  it('streams a generated report with download headers', async () => {
    service.generateReport.mockResolvedValue({
      filename: 'transactions-report.csv',
      contentType: 'text/csv',
      content: Buffer.from('a,b\n1,2'),
    });
    const res = { setHeader: jest.fn(), send: jest.fn() };
    const dto: GenerateReportDto = {
      type: ComplianceReportType.TRANSACTIONS,
      format: ReportFormat.CSV,
    };

    await controller.generateReport(dto, res as never);

    expect(service.generateReport).toHaveBeenCalledWith(dto);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="transactions-report.csv"',
    );
    expect(res.send).toHaveBeenCalled();
  });
});
