import {
  ScheduledReportService,
  ScheduleFrequency,
  calculateNextRunFromCron,
  parseCronExpression,
} from './scheduled-report.service';
import { ReportStatus } from '../entities/saved-report.entity';

describe('ScheduledReportService (issue #90)', () => {
  const makeReport = (overrides: Record<string, unknown> = {}) => ({
    id: 'report-1',
    userId: 'user-1',
    name: 'Daily revenue',
    reportType: 'revenue_report',
    format: 'json',
    status: ReportStatus.COMPLETED,
    dateFrom: new Date('2024-01-01'),
    dateTo: new Date('2024-01-31'),
    filters: undefined,
    metrics: undefined,
    dimensions: undefined,
    fileUrl: 'https://files.example/report.pdf',
    isScheduled: false,
    scheduleCron: undefined,
    scheduleFrequency: undefined,
    recipients: undefined,
    nextRunAt: undefined,
    lastRunAt: undefined,
    ...overrides,
  });

  const makeService = () => {
    const savedReportRepository = {
      findOne: jest.fn(),
      save: jest.fn(async (report: unknown) => report),
      find: jest.fn(),
    };
    const reportGeneratorService = {
      createReport: jest.fn(async () => makeReport({ id: 'report-2' })),
    };
    const service = new ScheduledReportService(
      savedReportRepository as never,
      reportGeneratorService as never,
    );
    return { service, savedReportRepository, reportGeneratorService };
  };

  it('scheduleReport persists nextRunAt, frequency, cron and recipients on the row', async () => {
    const { service, savedReportRepository } = makeService();
    const report = makeReport();
    savedReportRepository.findOne.mockResolvedValue(report);

    const before = Date.now();
    const config = await service.scheduleReport('report-1', {
      frequency: ScheduleFrequency.DAILY,
      recipients: ['ops@example.com'],
    });

    expect(report.isScheduled).toBe(true);
    expect(report.scheduleCron).toBe('0 0 * * *');
    expect(report.scheduleFrequency).toBe(ScheduleFrequency.DAILY);
    expect(report.recipients).toEqual(['ops@example.com']);
    expect(report.nextRunAt).toBeInstanceOf(Date);
    expect(report.nextRunAt.getTime()).toBeGreaterThan(before);
    expect(report.nextRunAt.getTime()).toBeLessThanOrEqual(
      before + 2 * 24 * 60 * 60 * 1000,
    );
    expect(config.nextRunAt).toEqual(report.nextRunAt);
    expect(config.cronExpression).toBe('0 0 * * *');
    expect(savedReportRepository.save).toHaveBeenCalledWith(report);
  });

  it('scheduleReport honors CUSTOM cron in the persisted next run', async () => {
    const { service, savedReportRepository } = makeService();
    const report = makeReport();
    savedReportRepository.findOne.mockResolvedValue(report);

    const config = await service.scheduleReport('report-1', {
      frequency: ScheduleFrequency.CUSTOM,
      cronExpression: '5 0 * * *',
      recipients: ['ops@example.com'],
    });

    expect(report.scheduleCron).toBe('5 0 * * *');
    expect(report.scheduleFrequency).toBe(ScheduleFrequency.CUSTOM);
    expect(report.nextRunAt).toBeInstanceOf(Date);
    // Next midnight-05:00 run is after scheduling time.
    expect(report.nextRunAt.getMinutes()).toBe(5);
    expect(report.nextRunAt.getHours()).toBe(0);
    expect(config.cronExpression).toBe('5 0 * * *');
  });

  it('scheduleReport rejects CUSTOM without a cron expression', async () => {
    const { service, savedReportRepository } = makeService();
    savedReportRepository.findOne.mockResolvedValue(makeReport());

    await expect(
      service.scheduleReport('report-1', {
        frequency: ScheduleFrequency.CUSTOM,
        recipients: [],
      }),
    ).rejects.toThrow(/CUSTOM.*cron/i);
  });

  it('processScheduledReports finds a report whose persisted nextRunAt is in the past', async () => {
    const { service, savedReportRepository, reportGeneratorService } =
      makeService();
    const due = makeReport({
      isScheduled: true,
      scheduleCron: '0 0 * * *',
      scheduleFrequency: ScheduleFrequency.DAILY,
      recipients: ['ops@example.com'],
      nextRunAt: new Date(Date.now() - 60_000),
    });
    savedReportRepository.find.mockImplementation(async (options: any) => {
      // IsNull() query (missing nextRunAt) returns nothing; due query returns the row.
      return options?.where?.nextRunAt?.type === 'isNull' ? [] : [due];
    });

    await service.processScheduledReports();

    expect(reportGeneratorService.createReport).toHaveBeenCalledTimes(1);
    expect(due.nextRunAt).toBeInstanceOf(Date);
    expect(due.nextRunAt!.getTime()).toBeGreaterThan(
      Date.now() - 60_000,
    );
    expect(due.lastRunAt).toBeInstanceOf(Date);
  });

  it('processScheduledReports skip-and-logs rows with null nextRunAt', async () => {
    const { service, savedReportRepository, reportGeneratorService } =
      makeService();
    const legacy = makeReport({ isScheduled: true, nextRunAt: undefined });
    savedReportRepository.find.mockImplementation(async (options: any) => {
      return options?.where?.nextRunAt?.type === 'isNull' ? [legacy] : [];
    });
    const warn = jest.spyOn((service as any).logger, 'warn');

    await service.processScheduledReports();

    expect(reportGeneratorService.createReport).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('nextRunAt is null'),
    );
  });

  it('does not mark a report sent when the recipient list is empty', async () => {
    const { service } = makeService();
    const delivery = await service.sendReportToRecipients(
      makeReport() as never,
      [],
    );

    expect(delivery.status).not.toBe('sent');
    expect(delivery.status).toBe('failed');
    expect(delivery.errorMessage).toMatch(/No recipients/i);
  });

  it('processScheduledReport uses persisted recipients instead of []', async () => {
    const { service, savedReportRepository } = makeService();
    const due = makeReport({
      isScheduled: true,
      scheduleCron: '0 0 * * *',
      scheduleFrequency: ScheduleFrequency.DAILY,
      recipients: ['a@example.com', 'b@example.com'],
      nextRunAt: new Date(Date.now() - 60_000),
    });
    savedReportRepository.find.mockImplementation(async (options: any) => {
      return options?.where?.nextRunAt?.type === 'isNull' ? [] : [due];
    });
    const sendSpy = jest.spyOn(service, 'sendReportToRecipients');

    await service.processScheduledReports();

    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'report-2' }),
      ['a@example.com', 'b@example.com'],
    );
    await expect(sendSpy.mock.results[0]?.value).resolves.toMatchObject({
      status: 'sent',
    });
  });

  it('getFrequencyFromCron classifies a non-zero-minute cron as CUSTOM, not DAILY', () => {
    const { service } = makeService();
    const frequencyFromCron = (service as any).getFrequencyFromCron.bind(service);

    expect(frequencyFromCron('5 0 1 1,4,7,10 *')).toBe(
      ScheduleFrequency.CUSTOM,
    );
    expect(frequencyFromCron('0 0 1 1,4,7,10 *')).toBe(
      ScheduleFrequency.QUARTERLY,
    );
    expect(frequencyFromCron('0 0 * * *')).toBe(ScheduleFrequency.DAILY);
    expect(frequencyFromCron('0 0 * * 0')).toBe(ScheduleFrequency.WEEKLY);
    expect(frequencyFromCron('0 0 1 * *')).toBe(ScheduleFrequency.MONTHLY);
    expect(frequencyFromCron('30 2 * * *')).toBe(ScheduleFrequency.CUSTOM);
  });

  it('getCronForFrequency no longer silently converts CUSTOM to daily', () => {
    const { service } = makeService();
    const cronForFrequency = (service as any).getCronForFrequency.bind(service);

    expect(() => cronForFrequency(ScheduleFrequency.CUSTOM)).toThrow(
      /CUSTOM.*cron/i,
    );
    expect(cronForFrequency(ScheduleFrequency.CUSTOM, '30 2 * * *')).toBe(
      '30 2 * * *',
    );
  });

  describe('next-run computation', () => {
    const { service } = makeService();
    const calculateNextRun = (service as any).calculateNextRun.bind(service);

    it('computes DAILY next run at next midnight', () => {
      const from = new Date('2026-01-15T12:34:00');
      expect(calculateNextRun(ScheduleFrequency.DAILY, undefined, from).toISOString()).toBe(
        new Date('2026-01-16T00:00:00').toISOString(),
      );
    });

    it('computes WEEKLY next run at next Sunday midnight', () => {
      // 2026-01-15 is a Thursday.
      const from = new Date('2026-01-15T12:00:00');
      const next = calculateNextRun(ScheduleFrequency.WEEKLY, undefined, from);
      expect(next.getDay()).toBe(0);
      expect(next.getHours()).toBe(0);
      expect(next.getTime()).toBeGreaterThan(from.getTime());
    });

    it('computes MONTHLY next run at the first of next month', () => {
      const from = new Date('2026-01-15T12:00:00');
      expect(calculateNextRun(ScheduleFrequency.MONTHLY, undefined, from).toISOString()).toBe(
        new Date('2026-02-01T00:00:00').toISOString(),
      );
    });

    it('computes QUARTERLY next run at the first of next quarter', () => {
      const from = new Date('2026-02-10T12:00:00');
      expect(calculateNextRun(ScheduleFrequency.QUARTERLY, undefined, from).toISOString()).toBe(
        new Date('2026-04-01T00:00:00').toISOString(),
      );
    });

    it('computes CUSTOM next run from the cron expression (non-zero minute)', () => {
      const from = new Date('2026-01-15T00:04:00');
      const next = calculateNextRun(
        ScheduleFrequency.CUSTOM,
        '5 0 * * *',
        from,
      );
      expect(next.toISOString()).toBe(
        new Date('2026-01-15T00:05:00').toISOString(),
      );
    });

    it('calculateNextRunFromCron handles quarterly cron with a non-zero minute', () => {
      const from = new Date('2026-01-01T00:00:00');
      expect(
        calculateNextRunFromCron('5 0 1 1,4,7,10 *', from).toISOString(),
      ).toBe(new Date('2026-01-01T00:05:00').toISOString());
    });

    it('parseCronExpression rejects malformed expressions', () => {
      expect(() => parseCronExpression('')).toThrow(/CUSTOM/i);
      expect(() => parseCronExpression('* * *')).toThrow(/5 fields/);
      expect(() => parseCronExpression('99 * * * *')).toThrow(/out of range/);
    });
  });
});
