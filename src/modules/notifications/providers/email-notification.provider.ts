import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Notification } from '../notification.class';
import { NotificationProvider } from './notification.provider';

@Injectable()
export class EmailNotificationProvider implements NotificationProvider {
  private readonly logger = new Logger(EmailNotificationProvider.name);
  private readonly fromAddress: string;

  constructor(private readonly configService: ConfigService) {
    this.fromAddress =
      this.configService.get<string>('NOTIFICATION_EMAIL_FROM') ??
      'noreply@interchangeabletrade.com';
  }

  async send(notification: Notification): Promise<void> {
    const subject =
      notification.metadata?.subject ?? 'Notification from InterChangableTrade';
    const htmlBody = this.renderHtml(notification);

    this.logger.log(
      `Sending email to ${notification.recipient}: "${subject}"`,
    );

    // In production this would call an email transport (SES, SendGrid, etc.)
    // For now we log the structured email for observability.
    this.logger.debug(
      JSON.stringify({
        from: this.fromAddress,
        to: notification.recipient,
        subject,
        html: htmlBody,
        text: notification.message,
      }),
    );
  }

  private renderHtml(notification: Notification): string {
    const title = notification.title ?? 'Notification';
    const message = notification.message;
    const metadata = notification.metadata;

    let metadataHtml = '';
    if (metadata && Object.keys(metadata).length > 0) {
      const rows = Object.entries(metadata)
        .filter(([k]) => k !== 'subject' && k !== 'htmlTemplate')
        .map(([key, value]) => `<tr><td style="padding:4px 12px 4px 0;font-weight:600;color:#555;">${key}</td><td style="padding:4px 0;">${String(value)}</td></tr>`)
        .join('\n');
      metadataHtml = `
        <table style="border-collapse:collapse;margin-top:16px;">
          ${rows}
        </table>
      `;
    }

    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
  <div style="background:#1a1a2e;color:#fff;padding:16px;border-radius:8px 8px 0 0;">
    <h1 style="margin:0;font-size:18px;">${title}</h1>
  </div>
  <div style="border:1px solid #e0e0e0;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
    <p style="color:#333;line-height:1.6;">${message}</p>
    ${metadataHtml}
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
    <p style="color:#999;font-size:12px;">
      This notification was sent by InterChangableTrade.
      Manage your notification preferences in your account settings.
    </p>
  </div>
</body>
</html>`;
  }

  renderOrderEmail(data: {
    orderId: string;
    side: string;
    assetCode: string;
    quantity: string;
    price: string;
    status: string;
  }): string {
    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
  <div style="background:#1a1a2e;color:#fff;padding:16px;border-radius:8px 8px 0 0;">
    <h1 style="margin:0;font-size:18px;">Order ${data.status.toUpperCase()}</h1>
  </div>
  <div style="border:1px solid #e0e0e0;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
    <p>Your ${data.side.toUpperCase()} order has been <strong>${data.status}</strong>.</p>
    <table style="border-collapse:collapse;margin:16px 0;">
      <tr><td style="padding:4px 12px 4px 0;font-weight:600;color:#555;">Order ID</td><td>${data.orderId}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;font-weight:600;color:#555;">Asset</td><td>${data.assetCode}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;font-weight:600;color:#555;">Quantity</td><td>${data.quantity}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;font-weight:600;color:#555;">Price</td><td>$${data.price}</td></tr>
    </table>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
    <p style="color:#999;font-size:12px;">InterChangableTrade &mdash; Manage notifications in account settings.</p>
  </div>
</body>
</html>`;
  }
}
