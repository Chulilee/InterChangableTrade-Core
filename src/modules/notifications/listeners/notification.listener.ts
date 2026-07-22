import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationEvents } from '../events/notification.events';
import { NotificationsService } from '../notifications.service';
import { Notification } from '../notification.class';

@Injectable()
export class NotificationListener {
  constructor(private readonly notificationsService: NotificationsService) {}

  @OnEvent(NotificationEvents.SEND_NOTIFICATION)
  handleSendNotificationEvent(notification: Notification) {
    this.notificationsService.send(notification);
  }
}
