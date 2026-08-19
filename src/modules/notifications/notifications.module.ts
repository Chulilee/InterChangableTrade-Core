import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationStrategy } from './providers/notification.strategy';
import { WebSocketNotificationProvider } from './providers/websocket-notification.provider';
import { EmailNotificationProvider } from './providers/email-notification.provider';
import { SmsNotificationProvider } from './providers/sms-notification.provider';
import { NotificationGateway } from './providers/notification.gateway';
import { NotificationListener } from './listeners/notification.listener';
import { Notification } from './entities/notification.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { NotificationTemplate } from './entities/notification-template.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Notification,
      NotificationPreference,
      NotificationTemplate,
    ]),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationGateway,
    NotificationStrategy,
    WebSocketNotificationProvider,
    EmailNotificationProvider,
    SmsNotificationProvider,
    NotificationListener,
  ],
  exports: [NotificationsService, NotificationGateway],
})
export class NotificationsModule {}
