import { Notification } from '../notification.class';

export interface NotificationProvider {
  send(notification: Notification): Promise<void>;
}
