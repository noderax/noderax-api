import { IsUUID } from 'class-validator';

export class NodeSubscriptionDto {
  @IsUUID()
  nodeId: string;
}
