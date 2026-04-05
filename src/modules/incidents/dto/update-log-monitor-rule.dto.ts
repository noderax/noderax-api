import { PartialType } from '@nestjs/swagger';
import { CreateLogMonitorRuleDto } from './create-log-monitor-rule.dto';

export class UpdateLogMonitorRuleDto extends PartialType(
  CreateLogMonitorRuleDto,
) {}
