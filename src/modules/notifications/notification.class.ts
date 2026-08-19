import { Channel } from './enums/channel.enum';
import { NotificationType } from './enums/notification-type.enum';
import { DeliveryStatus } from './enums/delivery-status.enum';

export class Notification {
  channel: Channel;
  recipient: string;
  message: string;
  type: NotificationType;
  title?: string;
  metadata?: Record<string, any>;
  templateName?: string;
  templateData?: Record<string, any>;
  scheduledAt?: Date;
  batchId?: string;
  deliveryStatus?: DeliveryStatus;

  constructor(
    channel: Channel,
    recipient: string,
    message: string,
    options?: {
      type?: NotificationType;
      title?: string;
      metadata?: Record<string, any>;
      templateName?: string;
      templateData?: Record<string, any>;
      scheduledAt?: Date;
      batchId?: string;
    },
  ) {
    this.channel = channel;
    this.recipient = recipient;
    this.message = message;
    this.type = options?.type ?? NotificationType.SYSTEM_NOTICE;
    this.title = options?.title;
    this.metadata = options?.metadata;
    this.templateName = options?.templateName;
    this.templateData = options?.templateData;
    this.scheduledAt = options?.scheduledAt;
    this.batchId = options?.batchId;
    this.deliveryStatus = DeliveryStatus.PENDING;
  }
}
