import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { INSTALLER_MANAGED_FLAG } from '../../../install/install-state';
import { UsersService } from '../users.service';

@Injectable()
export class DefaultAdminBootstrap implements OnApplicationBootstrap {
  constructor(private readonly usersService: UsersService) {}

  async onApplicationBootstrap() {
    if (process.env[INSTALLER_MANAGED_FLAG] === 'true') {
      return;
    }

    await this.usersService.ensureDefaultAdmin();
  }
}
