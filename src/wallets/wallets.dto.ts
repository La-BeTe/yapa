import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateWalletDto {
  @ApiPropertyOptional({ example: 'ada@example.com' })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ApiPropertyOptional({
    example: '+2348031234567',
    description: 'International format (E.164), including the country code',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;
}
