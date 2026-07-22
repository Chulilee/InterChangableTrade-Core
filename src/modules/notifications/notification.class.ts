import { Channel } from './enums/channel.enum';

export class Notification {
  channel: Channel;
  recipient: string;
  message: string;

  constructor(channel: Channel, recipient: string, message: string) {
    this.channel = channel;
    this.recipient = recipient;
    this.message = message;
  }
}
