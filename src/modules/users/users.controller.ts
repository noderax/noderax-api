import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SWAGGER_BEARER_AUTH_NAME } from '../../common/constants/swagger.constants';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../../common/types/authenticated-user.type';
import { CreateUserDto } from './dto/create-user.dto';
import { DeleteUserResponseDto } from './dto/delete-user-response.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserPreferencesDto } from './dto/update-user-preferences.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UserRole } from './entities/user-role.enum';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth(SWAGGER_BEARER_AUTH_NAME)
@ApiUnauthorizedResponse({
  description: 'JWT authentication required.',
})
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Roles(UserRole.PLATFORM_ADMIN)
  @Get()
  @ApiOperation({
    summary: 'List users',
  })
  @ApiOkResponse({
    description: 'List of users.',
    type: UserResponseDto,
    isArray: true,
  })
  @ApiForbiddenResponse({
    description: 'Admin role required.',
  })
  findAll() {
    return this.usersService.findAll();
  }

  @Get('me')
  @ApiOperation({
    summary: 'Get current user',
  })
  @ApiOkResponse({
    description: 'Authenticated user profile.',
    type: UserResponseDto,
  })
  async getMe(@CurrentUser() user: AuthenticatedUser) {
    const currentUser = await this.usersService.findOneOrFail(user.id);
    return this.usersService.toResponse(currentUser);
  }

  @Patch('me/preferences')
  @ApiOperation({
    summary: 'Update current user preferences',
  })
  @ApiOkResponse({
    description: 'Authenticated user preferences updated.',
    type: UserResponseDto,
  })
  updatePreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateUserPreferencesDto,
  ) {
    return this.usersService.updatePreferences(user.id, dto);
  }

  @Roles(UserRole.PLATFORM_ADMIN)
  @Post()
  @ApiOperation({
    summary: 'Create a user',
  })
  @ApiCreatedResponse({
    description: 'User created.',
    type: UserResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Admin role required.',
  })
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Roles(UserRole.PLATFORM_ADMIN)
  @Patch(':userId')
  @ApiOperation({
    summary: 'Update a user',
  })
  @ApiOkResponse({
    description: 'User updated.',
    type: UserResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Admin role required.',
  })
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(actor, userId, dto);
  }

  @Roles(UserRole.PLATFORM_ADMIN)
  @Delete(':userId')
  @ApiOperation({
    summary: 'Delete a user',
  })
  @ApiOkResponse({
    description: 'User deleted.',
    type: DeleteUserResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Admin role required.',
  })
  remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId') userId: string,
  ) {
    return this.usersService.delete(actor, userId);
  }
}
