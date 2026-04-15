import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { UserProfile } from './entities/user-profile.entity';
import { UserSerializer } from './serializers';
import { USER_NOT_FOUND } from './messages';

@Injectable()
export class MeService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserProfile)
    private readonly profileRepo: Repository<UserProfile>,
  ) {}

  async getMe(userId: string): Promise<UserSerializer> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException(USER_NOT_FOUND);
    return plainToInstance(UserSerializer, user, { excludeExtraneousValues: true });
  }

  async getMyProfile(userId: string): Promise<UserProfile | null> {
    return this.profileRepo.findOne({ where: { userId } });
  }
}
