import { UserRole } from '../../modules/users/entities/user-role.enum';

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  name: string;
  sessionVersion: number;
}
