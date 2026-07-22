import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

@Injectable()
export class DlqService {
  constructor(@InjectQueue('dead-letter-queue') private readonly dlq: Queue) {}

  async add(job: any, error: Error): Promise<void> {
    await this.dlq.add({
      job,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      timestamp: new Date().toISOString(),
    });
  }
}
