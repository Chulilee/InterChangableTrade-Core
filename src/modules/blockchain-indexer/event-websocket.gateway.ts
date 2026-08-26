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
import { SubscriptionManager } from './services/subscription-manager.service';

/**
 * WebSocket gateway for real-time event subscriptions. Frontend clients
 * connect to `/blockchain-indexer` and subscribe to specific event types
 * (trade executions, balance updates, liquidations, contract events).
 *
 * Protocol:
 * - Client emits `subscribe` with filter options
 * - Server pushes `event` messages for matching events
 * - Client emits `unsubscribe` to stop receiving events
 * - Server pushes `health` for connection status updates
 */
@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/blockchain-indexer',
})
export class EventWebSocketGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventWebSocketGateway.name);

  constructor(private readonly subscriptionManager: SubscriptionManager) {}

  handleConnection(client: Socket): void {
    const clientId = client.id;
    this.logger.log(`Client connected: ${clientId}`);

    // Listen for events destined for this client and forward them.
    const eventHandler = (payload: {
      subscriptionId: string;
      event: unknown;
    }) => {
      client.emit('event', {
        subscriptionId: payload.subscriptionId,
        data: payload.event,
      });
    };

    this.subscriptionManager.on(`event:${clientId}`, eventHandler);

    // Clean up the listener when the client disconnects.
    client.on('disconnect', () => {
      this.subscriptionManager.removeListener(
        `event:${clientId}`,
        eventHandler,
      );
    });

    // Notify the client of successful connection.
    client.emit('connected', {
      clientId,
      message: 'Connected to blockchain event stream',
      timestamp: new Date().toISOString(),
    });
  }

  handleDisconnect(client: Socket): void {
    const removed = this.subscriptionManager.removeClientSubscriptions(
      client.id,
    );
    this.logger.log(
      `Client disconnected: ${client.id} (${removed} subscriptions removed)`,
    );
  }

  /**
   * Subscribe to events with optional filters.
   *
   * @example
   * socket.emit('subscribe', {
   *   eventTypes: ['trade', 'liquidation'],
   *   contractIds: ['C...'],
   *   accounts: ['G...'],
   *   fromLedger: 100000,
   * })
   */
  @SubscribeMessage('subscribe')
  handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      eventTypes?: string[];
      contractIds?: string[];
      accounts?: string[];
      fromLedger?: number;
    },
  ): void {
    const subscriptionId = this.subscriptionManager.subscribe({
      clientId: client.id,
      eventTypes: data.eventTypes ?? [],
      contractIds: data.contractIds,
      accounts: data.accounts,
      fromLedger: data.fromLedger,
    });

    client.emit('subscribed', {
      subscriptionId,
      filters: data,
      message: 'Successfully subscribed to event stream',
    });

    this.logger.debug(`Client ${client.id} subscribed as ${subscriptionId}`);
  }

  /**
   * Unsubscribe from a specific subscription.
   *
   * @example
   * socket.emit('unsubscribe', { subscriptionId: 'sub_1' })
   */
  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { subscriptionId: string },
  ): void {
    const removed = this.subscriptionManager.unsubscribe(data.subscriptionId);
    client.emit('unsubscribed', {
      subscriptionId: data.subscriptionId,
      success: removed,
    });
  }

  /**
   * Returns the current connection status.
   */
  @SubscribeMessage('status')
  handleStatus(@ConnectedSocket() client: Socket): void {
    const subs = this.subscriptionManager.listSubscriptions(client.id);
    client.emit('status', {
      subscriptionCount: subs.length,
      subscriptions: subs,
    });
  }

  /**
   * Broadcasts a message to all connected clients (admin use).
   */
  broadcastToAll(eventType: string, data: unknown): void {
    this.server.emit(eventType, data);
  }
}
