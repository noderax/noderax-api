import { Controller, Get, Query } from '@nestjs/common';
import { EventsService } from './events.service';
import { QueryEventsDto } from './dto/query-events.dto';

@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  findAll(@Query() query: QueryEventsDto) {
    return this.eventsService.findAll(query);
  }
}
