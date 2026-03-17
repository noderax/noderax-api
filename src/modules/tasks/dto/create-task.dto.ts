import {
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateTaskDto {
  @IsUUID()
  nodeId: string;

  @IsString()
  @MinLength(2)
  type: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}
