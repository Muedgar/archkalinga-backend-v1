import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Organization } from './entities/organization.entity';

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectRepository(Organization)
    private readonly orgRepo: Repository<Organization>,
  ) {}

  async findById(id: string): Promise<Organization> {
    const org = await this.orgRepo.findOne({ where: { id } });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async create(data: {
    name: string;
    address?: string | null;
    city?: string | null;
    country?: string | null;
    website?: string | null;
  }): Promise<Organization> {
    const org = this.orgRepo.create({
      name: data.name,
      address: data.address ?? null,
      city: data.city ?? null,
      country: data.country ?? null,
      website: data.website ?? null,
    });
    return this.orgRepo.save(org);
  }
}
