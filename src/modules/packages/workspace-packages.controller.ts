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
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiBody,
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
import { WorkspaceRoles } from '../../common/decorators/workspace-roles.decorator';
import { WorkspaceMembershipGuard } from '../../common/guards/workspace-membership.guard';
import { WorkspaceRolesGuard } from '../../common/guards/workspace-roles.guard';
import { WorkspaceMembershipRole } from '../workspaces/entities/workspace-membership-role.enum';
import { InstallPackagesDto } from './dto/install-packages.dto';
import { ListPackagesResponseDto } from './dto/list-packages-response.dto';
import { PackageTaskAcceptedDto } from './dto/package-task-accepted.dto';
import { QueryPackageRemovalDto } from './dto/query-package-removal.dto';
import { QueryPackageSearchDto } from './dto/query-package-search.dto';
import { SearchPackagesResponseDto } from './dto/search-packages-response.dto';
import { PackagesService } from './packages.service';

@ApiTags('Workspace Packages')
@ApiBearerAuth(SWAGGER_BEARER_AUTH_NAME)
@ApiUnauthorizedResponse({
  description: 'JWT authentication required.',
})
@Controller('workspaces/:workspaceId')
@UseGuards(WorkspaceMembershipGuard)
export class WorkspacePackagesController {
  constructor(private readonly packagesService: PackagesService) {}

  @Get('nodes/:id/packages')
  @ApiParam({
    name: 'id',
    format: 'uuid',
    example: 'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
  })
  @ApiOperation({
    summary: 'List installed packages for a workspace node',
  })
  @ApiOkResponse({
    type: ListPackagesResponseDto,
  })
  @ApiAcceptedResponse({
    type: PackageTaskAcceptedDto,
  })
  @ApiNotFoundResponse({
    description: 'Node not found.',
  })
  async listInstalled(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.packagesService.listInstalled(id, workspaceId);
    response.status(result.statusCode);
    return result.body;
  }

  @Get('packages/search')
  @ApiQuery({
    name: 'term',
    required: true,
  })
  @ApiQuery({
    name: 'nodeId',
    required: true,
    format: 'uuid',
  })
  @ApiOperation({
    summary: 'Search packages for a workspace node',
  })
  @ApiOkResponse({
    type: SearchPackagesResponseDto,
  })
  @ApiAcceptedResponse({
    type: PackageTaskAcceptedDto,
  })
  async search(
    @Param('workspaceId') workspaceId: string,
    @Query() query: QueryPackageSearchDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.packagesService.search(query, workspaceId);
    response.status(result.statusCode);
    return result.body;
  }

  @Post('nodes/:id/packages')
  @UseGuards(WorkspaceRolesGuard)
  @WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBody({
    type: InstallPackagesDto,
  })
  @ApiOperation({
    summary: 'Install packages on a workspace node',
  })
  @ApiAcceptedResponse({
    type: PackageTaskAcceptedDto,
  })
  @ApiForbiddenResponse({
    description: 'Workspace owner or admin access required.',
  })
  install(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() body: InstallPackagesDto,
  ) {
    return this.packagesService.install(id, body, workspaceId);
  }

  @Delete('nodes/:id/packages/:name')
  @UseGuards(WorkspaceRolesGuard)
  @WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Remove or purge a package on a workspace node',
  })
  remove(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Param('name') name: string,
    @Query() query: QueryPackageRemovalDto,
  ) {
    return this.packagesService.remove(id, name, query, workspaceId);
  }
}
