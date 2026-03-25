import { Expose } from 'class-transformer';
import { BaseSerializer } from 'src/common/serializers';
import { Organization } from '../entities/organization.entity';

/**
 * Maps Organization internal fields to the shape the frontend expects.
 * The frontend uses organizationName / organizationAddress / etc. so we
 * alias the internal name/address/city/country columns to those keys.
 */
export class OrganizationSerializer extends BaseSerializer {
  @Expose()
  get organizationName(): string {
    return (this as unknown as Organization).name;
  }

  @Expose()
  get organizationAddress(): string | null {
    return (this as unknown as Organization).address;
  }

  @Expose()
  get organizationCity(): string | null {
    return (this as unknown as Organization).city;
  }

  @Expose()
  get organizationCountry(): string | null {
    return (this as unknown as Organization).country;
  }

  @Expose()
  get organizationWebsite(): string | null {
    return (this as unknown as Organization).website;
  }
}
