// Jeepney fare rules. CHECK THESE against the latest LTFRB fare matrix
// before release; fares change after fuel-price hearings.
export const FARE_RULES = {
  base: 13, // pesos for the first `baseKm` kilometers (traditional jeepney)
  baseKm: 4,
  perKm: 1.8, // pesos for every succeeding kilometer
  discount: 0.2, // students, seniors and PWD
  source: 'LTFRB traditional jeepney fare (verify the current matrix)',
};

const roundToQuarter = (n) => Math.round(n * 4) / 4;

export function computeFare(meters, rules = FARE_RULES) {
  const km = meters / 1000;
  const extraKm = Math.max(0, Math.ceil(km - rules.baseKm));
  const regular = roundToQuarter(rules.base + extraKm * rules.perKm);
  const discounted = roundToQuarter(regular * (1 - rules.discount));
  return { km, regular, discounted };
}

export const peso = (n) => `₱${n.toFixed(2)}`;
