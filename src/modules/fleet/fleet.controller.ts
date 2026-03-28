import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SWAGGER_BEARER_AUTH_NAME } from '../../common/constants/swagger.constants';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user-role.enum';
import { FleetNodeDto } from './dto/fleet-node.dto';
import { QueryFleetNodesDto } from './dto/query-fleet-nodes.dto';
import { FleetService } from './fleet.service';

@ApiTags('Fleet')
@ApiBearerAuth(SWAGGER_BEARER_AUTH_NAME)
@ApiUnauthorizedResponse({
  description: 'JWT authentication required.',
})
@Roles(UserRole.PLATFORM_ADMIN)
@Controller('fleet')
export class FleetController {
  constructor(private readonly fleetService: FleetService) {}

  @Get('nodes')
  @ApiOkResponse({
    type: FleetNodeDto,
    isArray: true,
  })
  listFleetNodes(@Query() query: QueryFleetNodesDto) {
    return this.fleetService.listFleetNodes(query);
  }
}
