/**
 * Prices (section 5). All values are whole millions of dollars.
 *
 *   market_value_m = floor(anchor * growth ^ (overall - 80) + 0.5)   min 1
 *   base_price_m   = floor(base_fraction * market_value_m + 0.5)     min 1
 */

export interface PriceParams {
  /** Market value of an 80-rated player. */
  anchor: number;
  /** Multiplier per overall point. */
  growth: number;
  /** Base price as a fraction of market value. */
  baseFraction: number;
}

export const DEFAULT_PRICE_PARAMS: PriceParams = {
  anchor: 60,
  growth: 1.075,
  baseFraction: 0.5,
};

/** Round half up (never banker's rounding). */
function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

export function marketValue(overall: number, params: PriceParams = DEFAULT_PRICE_PARAMS): number {
  return Math.max(1, roundHalfUp(params.anchor * Math.pow(params.growth, overall - 80)));
}

export function basePriceFromMarketValue(
  marketValueM: number,
  params: PriceParams = DEFAULT_PRICE_PARAMS,
): number {
  return Math.max(1, roundHalfUp(params.baseFraction * marketValueM));
}

export function basePrice(overall: number, params: PriceParams = DEFAULT_PRICE_PARAMS): number {
  return basePriceFromMarketValue(marketValue(overall, params), params);
}

export function prices(
  overall: number,
  params: PriceParams = DEFAULT_PRICE_PARAMS,
): { marketValueM: number; basePriceM: number } {
  const marketValueM = marketValue(overall, params);
  return { marketValueM, basePriceM: basePriceFromMarketValue(marketValueM, params) };
}
