import { Test, TestingModule } from '@nestjs/testing';
import { ErrorHandlerService } from './error-handler.service';
import { DlqService } from '../queue/dlq.service';
import { AppError, ErrorCategory, UnknownError } from './errors';
import { HttpStatus } from '@nestjs/common';

class TestError extends AppError {
  readonly category = ErrorCategory.TEST;
  constructor() {
    super('Test Error', HttpStatus.INTERNAL_SERVER_ERROR);
  }
}

describe('ErrorHandlerService', () => {
  let service: ErrorHandlerService;
  let dlqService: DlqService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ErrorHandlerService,
        {
          provide: DlqService,
          useValue: {
            add: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ErrorHandlerService>(ErrorHandlerService);
    dlqService = module.get<DlqService>(DlqService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should handle AppError', () => {
    const error = new TestError();
    const result = service.handle(error);
    expect(result).toBe(error);
  });

  it('should handle unknown error', () => {
    const error = new Error('Test Error');
    const result = service.handle(error);
    expect(result).toBeInstanceOf(UnknownError);
    expect(dlqService.add).toHaveBeenCalled();
  });
});
