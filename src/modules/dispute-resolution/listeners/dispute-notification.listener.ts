import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DisputeEvents } from '../events/dispute.events';
import { NotificationsService } from '../../notifications/notifications.service';
import { Notification } from '../../notifications/notification.class';
import { Channel } from '../../notifications/enums/channel.enum';

@Injectable()
export class DisputeNotificationListener {
  constructor(private readonly notificationsService: NotificationsService) {}

  @OnEvent(DisputeEvents.DISPUTE_CREATED)
  async handleDisputeCreated(payload: {
    disputeId: string;
    complainantId: string;
    respondentId: string;
  }) {
    const notification = new Notification(
      Channel.EMAIL,
      payload.respondentId,
      `A dispute has been filed against you (Dispute #${payload.disputeId}). Please review and respond.`,
    );
    await this.notificationsService.send(notification);
  }

  @OnEvent(DisputeEvents.DISPUTE_RESOLVED)
  async handleDisputeResolved(payload: {
    disputeId: string;
    resolutionType: string;
    complainantId: string;
    respondentId: string;
  }) {
    const message = `Dispute #${payload.disputeId} has been resolved: ${payload.resolutionType}`;

    await Promise.all([
      this.notificationsService.send(
        new Notification(Channel.EMAIL, payload.complainantId, message),
      ),
      this.notificationsService.send(
        new Notification(Channel.EMAIL, payload.respondentId, message),
      ),
    ]);
  }

  @OnEvent(DisputeEvents.ARBITRATOR_ASSIGNED)
  async handleArbitratorAssigned(payload: {
    disputeId: string;
    arbitratorId: string;
  }) {
    await this.notificationsService.send(
      new Notification(
        Channel.EMAIL,
        payload.arbitratorId,
        `You have been assigned to dispute #${payload.disputeId}`,
      ),
    );
  }
}
