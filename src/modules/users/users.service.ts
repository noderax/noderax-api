import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import {
  AUTH_CONFIG_KEY,
  BOOTSTRAP_CONFIG_KEY,
  authConfig,
  bootstrapConfig,
} from '../../config';
import {
  assertValidTimeZone,
  DEFAULT_TIMEZONE,
} from '../../common/utils/timezone.util';
import { ScheduledTaskEntity } from '../tasks/entities/scheduled-task.entity';
import { computeNextScheduledRun } from '../tasks/scheduled-task.utils';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserPreferencesDto } from './dto/update-user-preferences.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UserEntity } from './entities/user.entity';
import { UserRole } from './entities/user-role.enum';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    @InjectRepository(ScheduledTaskEntity)
    private readonly scheduledTasksRepository: Repository<ScheduledTaskEntity>,
    private readonly configService: ConfigService,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<UserResponseDto> {
    const existingUser = await this.usersRepository.findOne({
      where: { email: createUserDto.email },
    });

    if (existingUser) {
      throw new ConflictException('A user with this email already exists');
    }

    const passwordHash = await this.hashPassword(createUserDto.password);

    const user = this.usersRepository.create({
      email: createUserDto.email,
      name: createUserDto.name,
      role: createUserDto.role ?? UserRole.USER,
      passwordHash,
      timezone: DEFAULT_TIMEZONE,
    });

    const savedUser = await this.usersRepository.save(user);
    return this.toResponse(savedUser);
  }

  async findAll(): Promise<UserResponseDto[]> {
    const users = await this.usersRepository.find({
      order: { createdAt: 'DESC' },
    });

    return users.map((user) => this.toResponse(user));
  }

  async findOneOrFail(id: string) {
    const user = await this.usersRepository.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException(`User ${id} was not found`);
    }

    return user;
  }

  async updatePreferences(
    userId: string,
    dto: UpdateUserPreferencesDto,
  ): Promise<UserResponseDto> {
    const user = await this.findOneOrFail(userId);
    const timezone = assertValidTimeZone(dto.timezone);

    if (!timezone) {
      throw new BadRequestException('Timezone is required.');
    }

    const timezoneChanged = user.timezone !== timezone;
    if (!timezoneChanged) {
      return this.toResponse(user);
    }

    user.timezone = timezone;
    const savedUser = await this.usersRepository.save(user);
    const ownedSchedules = await this.scheduledTasksRepository.find({
      where: { ownerUserId: savedUser.id },
      order: { createdAt: 'ASC' },
    });

    if (ownedSchedules.length > 0) {
      const now = new Date();

      for (const schedule of ownedSchedules) {
        schedule.timezone = savedUser.timezone;
        schedule.claimToken = null;
        schedule.claimedBy = null;
        schedule.leaseUntil = null;
        schedule.nextRunAt = schedule.enabled
          ? computeNextScheduledRun(schedule, now)
          : null;
      }

      await this.scheduledTasksRepository.save(ownedSchedules);
    }

    return this.toResponse(savedUser);
  }

  async findByEmail(email: string) {
    return this.usersRepository.findOne({
      where: { email: email.toLowerCase() },
    });
  }

  async findByEmailWithPassword(email: string) {
    return this.usersRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('LOWER(user.email) = LOWER(:email)', { email })
      .getOne();
  }

  async ensureDefaultAdmin() {
    const bootstrap =
      this.configService.getOrThrow<ConfigType<typeof bootstrapConfig>>(
        BOOTSTRAP_CONFIG_KEY,
      );

    if (!bootstrap.seedDefaultAdmin) {
      return;
    }

    const existingAdmin = await this.usersRepository.findOne({
      where: { email: bootstrap.adminEmail.toLowerCase() },
    });

    if (existingAdmin) {
      return;
    }

    const passwordHash = await this.hashPassword(bootstrap.adminPassword);

    const adminUser = this.usersRepository.create({
      email: bootstrap.adminEmail.toLowerCase(),
      name: bootstrap.adminName,
      role: UserRole.ADMIN,
      passwordHash,
      timezone: DEFAULT_TIMEZONE,
    });

    await this.usersRepository.save(adminUser);
    this.logger.log(`Seeded default admin user: ${bootstrap.adminEmail}`);
  }

  toResponse(user: UserEntity): UserResponseDto {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      timezone: user.timezone,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private async hashPassword(password: string) {
    const auth =
      this.configService.getOrThrow<ConfigType<typeof authConfig>>(
        AUTH_CONFIG_KEY,
      );
    return bcrypt.hash(password, auth.bcryptSaltRounds);
  }
}
