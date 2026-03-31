import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiGoneResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { ConsumeNodeInstallDto } from './dto/consume-node-install.dto';
import { ConsumeNodeInstallResponseDto } from './dto/consume-node-install-response.dto';
import { NodeInstallStatusResponseDto } from './dto/node-install-status-response.dto';
import { ReportNodeInstallProgressDto } from './dto/report-node-install-progress.dto';
import { EnrollmentsService } from './enrollments.service';

@ApiTags('Node Installs')
@ApiExtraModels(
  ConsumeNodeInstallDto,
  ConsumeNodeInstallResponseDto,
  ReportNodeInstallProgressDto,
  NodeInstallStatusResponseDto,
)
@Controller('node-installs')
export class NodeInstallsController {
  constructor(private readonly enrollmentsService: EnrollmentsService) {}

  @Public()
  @Post('consume')
  @ApiOperation({
    summary: 'Consume a one-click node install token',
  })
  @ApiBody({
    type: ConsumeNodeInstallDto,
  })
  @ApiCreatedResponse({
    description: 'Node created and agent credentials issued.',
    type: ConsumeNodeInstallResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Bootstrap token was not found.',
  })
  @ApiGoneResponse({
    description: 'Bootstrap token has expired.',
  })
  consume(@Body() body: ConsumeNodeInstallDto) {
    return this.enrollmentsService.consumeNodeInstall(body);
  }

  @Public()
  @Post('progress')
  @ApiOperation({
    summary: 'Report one-click installer progress',
  })
  @ApiBody({
    type: ReportNodeInstallProgressDto,
  })
  @ApiOkResponse({
    description: 'Installer progress accepted.',
    type: NodeInstallStatusResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Bootstrap token was not found.',
  })
  @ApiGoneResponse({
    description: 'Bootstrap token has expired.',
  })
  reportProgress(@Body() body: ReportNodeInstallProgressDto) {
    return this.enrollmentsService.reportNodeInstallProgress(body);
  }
}
