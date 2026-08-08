// Cost + carbon footprint estimation.
// Adjust TARIFF_SLABS to your actual electricity board's rates (₹/kWh)
// and GRID_CARBON_FACTOR to your regional grid emission factor.

const TARIFF_SLABS = [
  { upTo: 100, rate: 3.5 },
  { upTo: 200, rate: 5.0 },
  { upTo: 400, rate: 6.5 },
  { upTo: Infinity, rate: 8.0 }
];

const GRID_CARBON_FACTOR = 0.82; // kg CO2 per kWh (approx. India grid average)

/** Slab-wise cost for a given monthly kWh total. */
function calculateCost(totalKWh) {
  let remaining = totalKWh;
  let prevCap = 0;
  let cost = 0;

  for (const slab of TARIFF_SLABS) {
    const slabUnits = Math.max(0, Math.min(remaining, slab.upTo - prevCap));
    cost += slabUnits * slab.rate;
    remaining -= slabUnits;
    prevCap = slab.upTo;
    if (remaining <= 0) break;
  }

  return +cost.toFixed(2);
}

function calculateCarbon(totalKWh) {
  return +(totalKWh * GRID_CARBON_FACTOR).toFixed(2);
}

/** Convert a running list of {power, time} readings (watts, taken every ~intervalSec) to kWh. */
function readingsToKWh(readings, intervalSec = 3) {
  const totalWattSeconds = readings.reduce((sum, r) => sum + r.power * intervalSec, 0);
  return totalWattSeconds / 3600 / 1000;
}

module.exports = { calculateCost, calculateCarbon, readingsToKWh, TARIFF_SLABS, GRID_CARBON_FACTOR };
