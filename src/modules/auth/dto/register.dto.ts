import { CreateUserDto } from '../../users/dto/create-user.dto';

/**
 * Registration accepts the same fields as user creation. Kept as a distinct
 * type so the auth surface can evolve independently of user administration.
 */
export class RegisterDto extends CreateUserDto {}
