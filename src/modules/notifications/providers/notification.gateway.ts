import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { Notification } from '../notification.class';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/notifications',
})
export class NotificationGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationGateway.name);
  private readonly userSockets = new Map<string, Set<string>>();

  handleConnection(client: Socket): void {
    const userId = client.handshake.query.userId as string;
    if (userId) {
      client.join(`user:${userId}`);
      if (!this.userSockets.has(userId)) {
        this.userSockets.set(userId, new Set());
      }
      this.userSockets.get(userId)!.add(client.id);
      this.logger.log(`Client connected: ${client.id} (user: ${userId})`);
    } else {
      this.logger.warn(`Client connected without userId: ${client.id}`);
    }
  }

  handleDisconnect(client: Socket): void {
    const userId = client.handshake.query.userId as string;
    if (userId) {
      const sockets = this.userSockets.get(userId);
      if (sockets) {
        sockets.delete(client.id);
        if (sockets.size === 0) {
          this.userSockets.delete(userId);
        }
      }
    }
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('markRead')
  handleMarkRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { notificationId: string },
  ): void {
    this.logger.debug(
      `User marked notification as read: ${data.notificationId}`,
    );
  }

  sendToUser(
    userId: string,
    notification: {
      id: string;
      type: string;
      title: string | null;
      message: string;
      metadata: Record<string, any> | null;
      createdAt: Date;
    },
  ): void {
    this.server.to(`user:${userId}`).emit('notification', {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      metadata: notification.metadata,
      createdAt: notification.createdAt,
    });
  }

  broadcastToAll(notification: {
    type: string;
    title: string | null;
    message: string;
    metadata: Record<string, any> | null;
    createdAt: Date;
  }): void {
    this.server.emit('notification', notification);
  }

  getUserCount(): number {
    return this.userSockets.size;
  }
}
