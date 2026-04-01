import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { NodeEntity } from '../../nodes/entities/node.entity';
import { UserRole } from '../../users/entities/user-role.enum';
import { WorkspacesService } from '../../workspaces/workspaces.service';

@Injectable()
export class RealtimeAuthorizationService {
  constructor(
    @InjectRepository(NodeEntity)
    private readonly nodesRepository: Repository<NodeEntity>,
    private readonly workspacesService: WorkspacesService,
  ) {}

  async assertCanAccessNode(
    user: AuthenticatedUser,
    nodeId: string,
  ): Promise<void> {
    const node = await this.nodesRepository.findOne({
      where: { id: nodeId },
      select: ['id', 'workspaceId'],
    });

    if (!node) {
      throw new NotFoundException(`Node ${nodeId} was not found`);
    }

    if (user.role === UserRole.PLATFORM_ADMIN) {
      return;
    }

    if (
      user.role === UserRole.USER &&
      (await this.workspacesService.findMembershipForUser(
        node.workspaceId,
        user.id,
      ))
    ) {
      return;
    }

    throw new ForbiddenException('You are not allowed to access this node');
  }

  async assertCanAccessWorkspace(
    user: AuthenticatedUser,
    workspaceId: string,
  ): Promise<void> {
    await this.workspacesService.findWorkspaceOrFail(workspaceId);

    if (user.role === UserRole.PLATFORM_ADMIN) {
      return;
    }

    if (
      user.role === UserRole.USER &&
      (await this.workspacesService.findMembershipForUser(workspaceId, user.id))
    ) {
      return;
    }

    throw new ForbiddenException(
      'You are not allowed to access this workspace',
    );
  }
}
