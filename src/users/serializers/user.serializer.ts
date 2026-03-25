import { Exclude, Expose, Transform, Type } from 'class-transformer';
import { BaseSerializer } from 'src/common/serializers';

class OrganizationShape {
  @Expose() id: string;
  @Expose() organizationName: string;
  @Expose() organizationAddress: string | null;
  @Expose() organizationCity: string | null;
  @Expose() organizationCountry: string | null;
}

class RoleShape {
  @Expose() id: string;
  @Expose() name: string;
  @Expose() slug: string;
  @Expose() status: boolean;
  @Expose() permissions: Record<string, Record<string, boolean>>;
}

/**
 * Full user shape returned by the API.
 * Matches the AuthUser and User interfaces the frontend expects.
 */
export class UserSerializer extends BaseSerializer {
  @Expose() firstName: string;
  @Expose() lastName: string;
  @Expose() userName: string;
  @Expose() email: string;
  @Expose() title: string | null;
  @Expose() userType: string;
  @Expose() status: boolean;
  @Expose() isDefaultPassword: boolean;
  @Expose() twoFactorAuthentication: boolean;
  @Expose() emailVerified: boolean;
  @Expose() roleId: string | null;
  @Expose() declare createdAt: Date;

  /**
   * Nested organization — the frontend always expects organizationName etc.
   * We transform the internal `name` field to `organizationName` here.
   */
  @Expose()
  @Transform(({ obj }: { obj: { organization?: { id: string; name: string; address: string | null; city: string | null; country: string | null } } }) => {
    const org = obj?.organization;
    if (!org) return null;
    return {
      id: org.id,
      organizationName: org.name,
      organizationAddress: org.address,
      organizationCity: org.city,
      organizationCountry: org.country,
    };
  })
  organization: OrganizationShape | null;

  @Expose()
  @Transform(({ obj }: { obj: { role?: { id: string; name: string; slug: string; status: boolean; permissions: Record<string, Record<string, boolean>> } | null } }) => {
    const role = obj?.role;
    if (!role) return null;
    return {
      id: role.id,
      name: role.name,
      slug: role.slug,
      status: role.status,
      permissions: role.permissions,
    };
  })
  role: RoleShape | null;

  // Excluded fields
  @Exclude() password: string;
  @Exclude() version: number;
  @Exclude() emailVerificationKey: string;
  @Exclude() emailVerificationExpiry: Date;
  @Exclude() tokenVersion: number;
  @Exclude() failedLoginAttempts: number;
  @Exclude() lockedUntil: Date | null;
  @Exclude() passwordResetTokenHash: string | null;
  @Exclude() passwordResetTokenExpiresAt: Date | null;
  @Exclude() passwordResetTokenUsedAt: Date | null;
}
