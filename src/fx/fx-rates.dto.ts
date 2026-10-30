import { IsBoolean, IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { CURRENCY_CODES, type CurrencyCode } from '../common/money/currency';

export class PairParams {
  @IsIn(CURRENCY_CODES)
  base!: CurrencyCode;

  @IsIn(CURRENCY_CODES)
  quote!: CurrencyCode;
}

export class UpdateFxRateDto {
  /** Static rate: units of quote currency per one unit of base currency. */
  @IsOptional()
  @Matches(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, { message: 'rate must be a positive decimal string' })
  rate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  spread_bps?: number;

  @IsOptional()
  @IsBoolean()
  prefer_static?: boolean;
}
