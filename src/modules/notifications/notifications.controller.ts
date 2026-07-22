import { Controller, Post, Body, Get, Put, Param } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationsService } from './notifications.service';
import { NotificationEvents } from './events/notification.events';
import { Notification } from './notification.class';
import { Channel } from './enums/channel.enum';
import { TestNotificationDto } from './dto/test-notification.dto';
import { UpdateNotificationPreferenceDto } from './dto/update-notification-preference.dto';
import { CreateNotificationTemplateDto } from './dto/create-notification-template.dto';
import { SendFromTemplateDto } from './dto/send-from-template.dto';

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Post('test')
  testNotification(@Body() testNotificationDto: TestNotificationDto) {
    const notification = new Notification(
      Channel.WEB_SOCKET,
      'test-user',
      testNotificationDto.message,
    );
    this.eventEmitter.emit(NotificationEvents.SEND_NOTIFICATION, notification);
    return { message: 'Notification sent!' };
  }

  @Post('templates')
  createTemplate(@Body() createTemplateDto: CreateNotificationTemplateDto) {
    return this.notificationsService.createTemplate(
      createTemplateDto.name,
      createTemplateDto.template,
    );
  }

  @Post('send-from-template')
  sendFromTemplate(@Body() sendFromTemplateDto: SendFromTemplateDto) {
    return this.notificationsService.sendFromTemplate(
      sendFromTemplateDto.templateName,
      sendFromTemplateDto.channel,
      sendFromTemplateDto.recipient,
      sendFromTemplateDto.data,
    );
  }

  @Get('preferences/:userId')
  getPreferences(@Param('userId') userId: string) {
    return this.notificationsService.getUserPreferences(userId);
  }

  @Put('preferences/:userId')
  updatePreference(
    @Param('userId') userId: string,
    @Body() updatePreferenceDto: UpdateNotificationPreferenceDto,
  ) {
    return this.notificationsService.updateUserPreference(
      userId,
      updatePreferenceDto.channel,
      updatePreferenceDto.isEnabled,
    );
  }
}
