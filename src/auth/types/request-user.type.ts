import { User } from 'src/users/entities';

export type RequestUser = Omit<User, 'pkid' | 'password'>;
