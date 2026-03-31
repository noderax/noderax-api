import { IsUUID } from 'class-validator';

export class WorkspaceSubscriptionDto {
  @IsUUID()
  workspaceId: string;
}
