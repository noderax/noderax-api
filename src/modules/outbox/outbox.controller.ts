import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SWAGGER_BEARER_AUTH_NAME } from '../../common/constants/swagger.constants';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user-role.enum';
import {
  OutboxDeadLetterListResponseDto,
  RemediateOutboxDeadLetterDto,
  RemediateOutboxDeadLetterResponseDto,
} from './dto/remediate-outbox-dead-letter.dto';
import { OutboxService } from './outbox.service';

@ApiTags('Outbox')
@ApiBearerAuth(SWAGGER_BEARER_AUTH_NAME)
@ApiUnauthorizedResponse({
  description: 'JWT authentication required.',
})
@Roles(UserRole.PLATFORM_ADMIN)
@Controller('outbox')
export class OutboxController {
  constructor(private readonly outboxService: OutboxService) {}

  @Get('dead-letter')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'List recent dead-letter outbox entries',
    description:
      'Returns recent dead-letter event.created entries that may be remediated from the admin UI.',
  })
  @ApiOkResponse({
    description: 'Recent dead-letter outbox entries.',
    type: OutboxDeadLetterListResponseDto,
  })
  async listDeadLetters(): Promise<OutboxDeadLetterListResponseDto> {
    return {
      items: await this.outboxService.getDeadLetterPreview(),
    };
  }

  @Post('dead-letter/requeue')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Requeue selected dead-letter outbox entries',
    description:
      'Resets selected dead-letter event.created entries so the dispatcher may retry them.',
  })
  @ApiOkResponse({
    description: 'Dead-letter entries requeued.',
    type: RemediateOutboxDeadLetterResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'At least one id is required and only dead-letter event.created records are allowed.',
  })
  async requeueDeadLetters(
    @Body() dto: RemediateOutboxDeadLetterDto,
  ): Promise<RemediateOutboxDeadLetterResponseDto> {
    return {
      success: true,
      affected: await this.outboxService.requeueDeadLetters(dto.ids),
    };
  }

  @Post('dead-letter/delete')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Delete selected dead-letter outbox entries',
    description:
      'Deletes selected dead-letter event.created entries from the outbox backlog.',
  })
  @ApiOkResponse({
    description: 'Dead-letter entries deleted.',
    type: RemediateOutboxDeadLetterResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'At least one id is required and only dead-letter event.created records are allowed.',
  })
  async deleteDeadLetters(
    @Body() dto: RemediateOutboxDeadLetterDto,
  ): Promise<RemediateOutboxDeadLetterResponseDto> {
    return {
      success: true,
      affected: await this.outboxService.deleteDeadLetters(dto.ids),
    };
  }
}
