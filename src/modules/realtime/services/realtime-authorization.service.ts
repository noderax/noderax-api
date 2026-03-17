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

@Injectable()
export class RealtimeAuthorizationService {
  constructor(
    @InjectRepository(NodeEntity)
    private readonly nodesRepository: Repository<NodeEntity>,
  ) {}

  async assertCanAccessNode(
    user: AuthenticatedUser,
    nodeId: string,
  ): Promise<void> {
    const nodeExists = await this.nodesRepository.exists({
      where: { id: nodeId },
    });

    if (!nodeExists) {
      throw new NotFoundException(`Node ${nodeId} was not found`);
    }

    if (user.role === UserRole.ADMIN) {
      return;
    }

    if (user.role === UserRole.USER) {
      // Placeholder policy: authenticated users currently inherit the same
      // node-read access as the HTTP API. Tighten this here when per-node ACLs land.
      return;
    }

    throw new ForbiddenException('You are not allowed to access this node');
  }
}
