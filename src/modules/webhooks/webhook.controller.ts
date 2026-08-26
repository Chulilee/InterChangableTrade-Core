import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../auth/decorators/current-user.decorator';
import { WebhookSubscriptionService } from './services/webhook-subscription.service';
import { WebhookDeliveryService } from './services/webhook-delivery.service';
import { WebhookSigningService } from './services/webhook-signing.service';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { UpdateWebhookDto } from './dto/update-webhook.dto';
import {
  QueryWebhookDto,
  QueryWebhookDeliveryDto,
} from './dto/query-webhook.dto';

/**
 * Webhook management controller.
 *
 * Provides endpoints for:
 * - Webhook subscription CRUD
 * - Webhook delivery history and retry
 * - Test webhook functionality
 * - Secret rotation
 * - Payload signing and verification
 */
@ApiTags('webhooks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('webhooks')
export class WebhookController {
  constructor(
    private readonly subscriptionService: WebhookSubscriptionService,
    private readonly deliveryService: WebhookDeliveryService,
    private readonly signingService: WebhookSigningService,
  ) {}

  // ─── Webhook Subscription Management ──────────────────────────────────

  @Post()
  @ApiOperation({
    summary: 'Register a new webhook',
    description:
      'Creates a new webhook subscription with event filtering. The signing secret is returned only once in the response.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Webhook created successfully',
  })
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWebhookDto,
  ) {
    const webhook = await this.subscriptionService.create(user.id, dto);
    return { success: true, data: webhook };
  }

  @Get()
  @ApiOperation({
    summary: "Get user's registered webhooks",
    description:
      'Returns a paginated list of webhook subscriptions for the authenticated user.',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Webhooks retrieved' })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryWebhookDto,
  ) {
    const result = await this.subscriptionService.findAllByUser(user.id, {
      status: query.status,
      search: query.search,
      page: query.page,
      limit: query.limit,
    });
    return { success: true, data: result };
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Get webhook statistics',
    description: "Returns aggregated statistics for the user's webhooks.",
  })
  async getStats(@CurrentUser() user: AuthenticatedUser) {
    const stats = await this.subscriptionService.getStats(user.id);
    return { success: true, data: stats };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a specific webhook',
    description: 'Returns detailed information about a webhook subscription.',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Webhook retrieved' })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const webhook = await this.subscriptionService.findOne(id, user.id);
    return { success: true, data: webhook };
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Update a webhook',
    description:
      'Updates an existing webhook subscription. Only provided fields are updated.',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Webhook updated' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    const webhook = await this.subscriptionService.update(id, user.id, dto);
    return { success: true, data: webhook };
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a webhook',
    description:
      'Permanently deletes a webhook subscription and its delivery history.',
  })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Webhook deleted',
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.subscriptionService.remove(id, user.id);
  }

  // ─── Webhook Control ─────────────────────────────────────────────────

  @Post(':id/pause')
  @ApiOperation({
    summary: 'Pause a webhook',
    description:
      'Temporarily pauses event delivery for a webhook subscription.',
  })
  async pause(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const webhook = await this.subscriptionService.pause(id, user.id);
    return { success: true, data: webhook };
  }

  @Post(':id/resume')
  @ApiOperation({
    summary: 'Resume a webhook',
    description: 'Resumes event delivery for a paused webhook subscription.',
  })
  async resume(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const webhook = await this.subscriptionService.resume(id, user.id);
    return { success: true, data: webhook };
  }

  @Post(':id/rotate-secret')
  @ApiOperation({
    summary: 'Rotate webhook signing secret',
    description:
      'Generates a new HMAC-SHA256 signing secret for the webhook. Update your verification code with the new secret.',
  })
  async rotateSecret(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.subscriptionService.rotateSecret(id, user.id);
    return { success: true, data: result };
  }

  // ─── Test Delivery ──────────────────────────────────────────────────

  @Post(':id/test')
  @ApiOperation({
    summary: 'Test webhook delivery',
    description:
      'Sends a test event to the webhook endpoint for debugging and verification.',
  })
  async sendTest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const delivery = await this.subscriptionService.sendTest(id, user.id);
    return { success: true, data: delivery };
  }

  // ─── Delivery History ───────────────────────────────────────────────

  @Get(':id/deliveries')
  @ApiOperation({
    summary: 'Get webhook delivery history',
    description:
      'Returns a paginated list of delivery attempts for a webhook subscription.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Delivery history retrieved',
  })
  async getDeliveries(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: QueryWebhookDeliveryDto,
  ) {
    // Verify ownership
    await this.subscriptionService.findOne(id, user.id);

    const result = await this.deliveryService.getDeliveries(id, {
      status: query.status,
      eventType: query.eventType,
      startDate: query.startDate,
      endDate: query.endDate,
      page: query.page,
      limit: query.limit,
    });
    return { success: true, data: result };
  }

  @Get(':id/deliveries/:deliveryId')
  @ApiOperation({
    summary: 'Get a specific delivery',
    description:
      'Returns detailed information about a specific webhook delivery.',
  })
  async getDelivery(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('deliveryId', ParseUUIDPipe) deliveryId: string,
  ) {
    // Verify ownership
    await this.subscriptionService.findOne(id, user.id);

    const delivery = await this.deliveryService.getDelivery(deliveryId);
    return { success: true, data: delivery };
  }

  @Post(':id/deliveries/:deliveryId/retry')
  @ApiOperation({
    summary: 'Retry a failed delivery',
    description: 'Manually retries a failed webhook delivery.',
  })
  async retryDelivery(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('deliveryId', ParseUUIDPipe) deliveryId: string,
  ) {
    // Verify ownership
    await this.subscriptionService.findOne(id, user.id);

    const delivery = await this.deliveryService.retryDelivery(deliveryId, id);
    return { success: true, data: delivery };
  }

  // ─── Signing & Verification ─────────────────────────────────────────

  @Post('verify-signature')
  @ApiOperation({
    summary: 'Verify a webhook signature',
    description:
      'Verifies the HMAC-SHA256 signature of a webhook payload. Useful for testing your verification logic.',
  })
  @HttpCode(HttpStatus.OK)
  async verifySignature(
    @Body() body: { payload: string; signature: string; secret: string },
  ) {
    const isValid = this.signingService.verifySignature(
      body.payload,
      body.signature,
      body.secret,
    );
    return { success: true, data: { valid: isValid } };
  }
}
