import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { AuthService } from '../core/auth.service';

/** Socket.IO: each authenticated user joins a private room "<tenant>:<userId>". Events: message, notification. */
@WebSocketGateway({ cors: { origin: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean) } })
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;
  constructor(private readonly auth: AuthService) {}

  async handleConnection(client: Socket) {
    try {
      const token = (client.handshake.auth as { token?: string } | undefined)?.token ?? '';
      const ctx = await this.auth.verify(token);
      if (!ctx.tenantSlug) throw new Error('no tenant');
      await client.join(`${ctx.tenantSlug}:${ctx.principal.id}`);
    } catch { client.disconnect(true); }
  }

  emitToUsers(tenant: string, userIds: string[], event: string, payload: unknown) {
    if (!this.server) return;
    for (const id of userIds) this.server.to(`${tenant}:${id}`).emit(event, payload);
  }
}
