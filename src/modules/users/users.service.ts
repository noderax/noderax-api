import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { authConfig, bootstrapConfig } from '../../config';
import { CreateUserDto } from './dto/create-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UserEntity } from './entities/user.entity';
import { UserRole } from './entities/user-role.enum';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
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
    const bootstrap = this.configService.getOrThrow<
      ConfigType<typeof bootstrapConfig>
    >(bootstrapConfig.KEY);

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
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private async hashPassword(password: string) {
    const auth = this.configService.getOrThrow<ConfigType<typeof authConfig>>(
      authConfig.KEY,
    );
    return bcrypt.hash(password, auth.bcryptSaltRounds);
  }
}
