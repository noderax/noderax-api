import { UserRole } from '../../modules/users/entities/user-role.enum';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  name: string;
}
