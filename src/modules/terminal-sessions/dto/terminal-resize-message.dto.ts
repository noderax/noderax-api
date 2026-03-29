import { Type } from 'class-transformer';
import { IsInt, IsUUID, Max, Min } from 'class-validator';

export class TerminalResizeMessageDto {
  @IsUUID()
  sessionId: string;

  @Type(() => Number)
  @IsInt()
  @Min(20)
  @Max(400)
  cols: number;

  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(200)
  rows: number;
}
