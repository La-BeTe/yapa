import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { CURRENCY_CODES, type CurrencyCode } from '../common/money/currency';

export class PairParams {
  @ApiProperty({ enum: CURRENCY_CODES })
  @IsIn(CURRENCY_CODES)
  base!: CurrencyCode;

  @ApiProperty({ enum: CURRENCY_CODES })
  @IsIn(CURRENCY_CODES)
  quote!: CurrencyCode;
}

export class UpdateFxRateDto {
  @ApiPropertyOptional({
    example: '0.95',
    description: 'Static rate: units of quote currency per one unit of base currency',
  })
  @IsOptional()
  @Matches(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, { message: 'rate must be a positive decimal string' })
  rate?: string;

  @ApiPropertyOptional({ example: 50, minimum: 0, maximum: 9999 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  spread_bps?: number;

  @ApiPropertyOptional({ description: 'Use the static rate instead of live rates for this pair' })
  @IsOptional()
  @IsBoolean()
  prefer_static?: boolean;
}
