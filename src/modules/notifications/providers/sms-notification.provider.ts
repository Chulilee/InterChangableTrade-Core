import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Notification } from '../notification.class';
import { NotificationProvider } from './notification.provider';

@Injectable()
export class SmsNotificationProvider implements NotificationProvider {
  private readonly logger = new Logger(SmsNotificationProvider.name);
  private readonly accountSid: string | undefined;
  private readonly authToken: string | undefined;
  private readonly fromNumber: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
    this.authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');
    this.fromNumber = this.configService.get<string>('TWILIO_PHONE_NUMBER');
  }

  async send(notification: Notification): Promise<void> {
    const smsBody = this.buildSmsBody(notification);

    this.logger.log(
      `Sending SMS to ${notification.recipient}: "${smsBody.substring(0, 80)}..."`,
    );

    if (!this.accountSid || !this.authToken || !this.fromNumber) {
      this.logger.warn(
        'Twilio credentials not configured — SMS delivery skipped',
      );
      return;
    }

    // In production, this would call the Twilio REST API:
    //
    //   const client = twilio(this.accountSid, this.authToken);
    //   await client.messages.create({
    //     body: smsBody,
    //     from: this.fromNumber,
    //     to: notification.recipient,
    //   });
    //
    // For now we log the structured SMS payload.
    this.logger.debug(
      JSON.stringify({
        from: this.fromNumber,
        to: notification.recipient,
        body: smsBody,
      }),
    );
  }

  private buildSmsBody(notification: Notification): string {
    const maxLen = 160;
    const prefix = notification.title
      ? `${notification.title}: `
      : '';
    const fullMessage = `${prefix}${notification.message}`;
    if (fullMessage.length <= maxLen) {
      return fullMessage;
    }
    return fullMessage.substring(0, maxLen - 3) + '...';
  }

  buildOrderSms(data: {
    side: string;
    assetCode: string;
    quantity: string;
    status: string;
  }): string {
    const statusEmoji =
      data.status === 'filled'
        ? '✅'
        : data.status === 'cancelled'
          ? '❌'
          : '📋';
    return `${statusEmoji} ${data.side.toUpperCase()} ${data.quantity} ${data.assetCode}: ${data.status.toUpperCase()}`;
  }

  buildPriceAlertSms(data: {
    assetCode: string;
    currentPrice: string;
    direction: string;
  }): string {
    return `🔔 ${data.assetCode} price ${data.direction} $${data.currentPrice}`;
  }
}
