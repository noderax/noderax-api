import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBody,
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Response } from 'express';
import { SWAGGER_BEARER_AUTH_NAME } from '../../common/constants/swagger.constants';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user-role.enum';
import { InstallPackagesDto } from './dto/install-packages.dto';
import { ListPackagesResponseDto } from './dto/list-packages-response.dto';
import { PackageTaskAcceptedDto } from './dto/package-task-accepted.dto';
import { QueryPackageRemovalDto } from './dto/query-package-removal.dto';
import { QueryPackageSearchDto } from './dto/query-package-search.dto';
import { SearchPackagesResponseDto } from './dto/search-packages-response.dto';
import { PackagesService } from './packages.service';

@ApiTags('Packages')
@ApiBearerAuth(SWAGGER_BEARER_AUTH_NAME)
@ApiUnauthorizedResponse({
  description: 'JWT authentication required.',
})
@ApiExtraModels(
  InstallPackagesDto,
  ListPackagesResponseDto,
  PackageTaskAcceptedDto,
  QueryPackageRemovalDto,
  QueryPackageSearchDto,
  SearchPackagesResponseDto,
)
@Controller()
export class PackagesController {
  constructor(private readonly packagesService: PackagesService) {}

  @Get('nodes/:id/packages')
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Target node identifier.',
    example: 'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
  })
  @ApiOperation({
    summary: 'List installed packages for a node',
    description:
      'Queues a packageList task for the node, waits up to 10 seconds for completion, and returns normalized package records when the agent responds in time. If the task is still queued or running after the wait window, the endpoint returns 202 so the client can continue with the existing task and log APIs.',
  })
  @ApiOkResponse({
    description: 'Installed packages or a terminal task error payload.',
    type: ListPackagesResponseDto,
  })
  @ApiAcceptedResponse({
    description: 'Task created but not yet completed.',
    type: PackageTaskAcceptedDto,
  })
  @ApiNotFoundResponse({
    description: 'Node not found.',
  })
  async listInstalled(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.packagesService.listInstalled(id);
    response.status(result.statusCode);
    return result.body;
  }

  @Get('packages/search')
  @ApiQuery({
    name: 'term',
    required: true,
    description: 'Search term passed to the packageSearch task.',
    example: 'nginx',
  })
  @ApiQuery({
    name: 'nodeId',
    required: true,
    format: 'uuid',
    description: 'Node whose package repositories should be searched.',
    example: 'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
  })
  @ApiOperation({
    summary: 'Search packages available to a node',
    description:
      'Queues a packageSearch task for the target node. Debian APT documents search behavior against package names and descriptions, and related apt-style output includes package metadata plus a short description. References: https://manpages.debian.org/experimental/apt/apt.8.en.html and https://manpages.debian.org/testing/apt/apt-cache.8.en.html',
  })
  @ApiOkResponse({
    description:
      'Structured package search results or a terminal task error payload.',
    type: SearchPackagesResponseDto,
  })
  @ApiAcceptedResponse({
    description: 'Task created but not yet completed.',
    type: PackageTaskAcceptedDto,
  })
  @ApiNotFoundResponse({
    description: 'Node not found.',
  })
  async search(
    @Query() query: QueryPackageSearchDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.packagesService.search(query);
    response.status(result.statusCode);
    return result.body;
  }

  @Roles(UserRole.ADMIN)
  @Post('nodes/:id/packages')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Target node identifier.',
    example: 'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
  })
  @ApiBody({
    type: InstallPackagesDto,
    description:
      'Package install request payload. The purge flag is forwarded to the packageInstall task payload for agent compatibility.',
  })
  @ApiOperation({
    summary: 'Install packages on a node',
    description:
      'Queues a packageInstall task for the target node. The response returns a task identifier immediately so the frontend can follow progress via the existing task detail and task log endpoints.',
  })
  @ApiAcceptedResponse({
    description: 'Package installation task queued.',
    type: PackageTaskAcceptedDto,
  })
  @ApiForbiddenResponse({
    description: 'Admin role required.',
  })
  @ApiNotFoundResponse({
    description: 'Node not found.',
  })
  install(@Param('id') id: string, @Body() body: InstallPackagesDto) {
    return this.packagesService.install(id, body);
  }

  @Roles(UserRole.ADMIN)
  @Delete('nodes/:id/packages/:name')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Target node identifier.',
    example: 'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
  })
  @ApiParam({
    name: 'name',
    description: 'Package name to remove from the node.',
    example: 'nginx',
  })
  @ApiQuery({
    name: 'purge',
    required: false,
    description:
      'When true, queues packagePurge. When false or omitted, queues packageRemove.',
    example: false,
  })
  @ApiOperation({
    summary: 'Remove or purge a package on a node',
    description:
      'Queues either a packageRemove or packagePurge task depending on the purge query parameter. Debian documents that remove leaves configuration files in place, while purge removes configuration files too: https://manpages.debian.org/experimental/apt/apt-get.8.en.html',
  })
  @ApiAcceptedResponse({
    description: 'Package removal task queued.',
    type: PackageTaskAcceptedDto,
  })
  @ApiForbiddenResponse({
    description: 'Admin role required.',
  })
  @ApiNotFoundResponse({
    description: 'Node not found.',
  })
  remove(
    @Param('id') id: string,
    @Param('name') name: string,
    @Query() query: QueryPackageRemovalDto,
  ) {
    return this.packagesService.remove(id, name, query);
  }
}
