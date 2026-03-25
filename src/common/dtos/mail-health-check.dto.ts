import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional } from 'class-validator';

export class MailHealthCheckDto {
  @ApiPropertyOptional({
    description:
      'Optional recipient email for the test message. Defaults to authenticated user email.',
    example: 'admin@example.com',
  })
  @IsOptional()
  @IsEmail()
  to?: string;
}

