import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { EventsService } from './events.service';
import { QueryEventsDto } from './dto/query-events.dto';
import { EventEntity } from './entities/event.entity';

@ApiTags('Events')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({
  description: 'JWT authentication required.',
})
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  @ApiOperation({
    summary: 'List events',
  })
  @ApiOkResponse({
    description: 'List of recorded events.',
    type: EventEntity,
    isArray: true,
  })
  findAll(@Query() query: QueryEventsDto) {
    return this.eventsService.findAll(query);
  }
}
