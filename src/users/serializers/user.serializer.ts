import { Exclude, Expose } from 'class-transformer';
import { BaseSerializer } from 'src/common/serializers';

/**
 * Public shape of a User in API responses.
 * Workspace role / membership data is NOT embedded here — it lives on the
 * WorkspaceMember record and is loaded separately by workspace-scoped endpoints.
 */
export class UserSerializer extends BaseSerializer {
  @Expose() firstName: string;
  @Expose() lastName: string;
  @Expose() userName: string;
  @Expose() email: string;
  @Expose() title: string | null;
  @Expose() status: boolean;
  @Expose() isDefaultPassword: boolean;
  @Expose() twoFactorAuthentication: boolean;
  @Expose() emailVerified: boolean;
  @Expose() isPublicProfile: boolean;
  @Expose() declare createdAt: Date;
  @Expose() declare updatedAt: Date;

  // Excluded security / internal fields
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
