import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  hasInstallState,
  readInstallTransitionState,
} from '../install/install-state';

@Injectable()
export class RuntimePromotionService implements OnModuleInit {
  private readonly logger = new Logger(RuntimePromotionService.name);

  onModuleInit(): void {
    if (process.env.NODERAX_RUNTIME_ROLE !== 'runtime_ha') {
      return;
    }

    if (!hasInstallState()) {
      return;
    }

    const transition = readInstallTransitionState();
    if (transition?.status !== 'promoting') {
      return;
    }

    this.logger.log(
      'HA runtime booted while promotion is in progress. Waiting for the host supervisor to finalize the runtime cutover.',
    );
  }
}
