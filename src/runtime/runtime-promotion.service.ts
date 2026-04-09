import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  clearInstallTransitionState,
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

    clearInstallTransitionState();
    this.logger.log('Cleared install transition state after HA runtime boot.');
  }
}
