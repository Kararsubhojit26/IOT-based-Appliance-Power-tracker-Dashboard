// Lightweight anomaly detection: keeps a rolling window of recent
// readings per appliance and flags a reading as anomalous if it
// deviates more than 2.5 standard deviations from the rolling mean.
// This is a statistical baseline, not a trained ML model — but it
// catches real issues (a fridge compressor drawing 40% more than
// usual, a fan bearing failing) without needing training data.

const WINDOW_SIZE = 40;
const windows = new Map(); // applianceName -> array of recent power readings

function checkAnomaly(applianceName, power) {
  if (!windows.has(applianceName)) windows.set(applianceName, []);
  const window = windows.get(applianceName);

  let anomaly = false;
  let mean = null, stdDev = null;

  if (window.length >= 10) {
    mean = window.reduce((a, b) => a + b, 0) / window.length;
    const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / window.length;
    stdDev = Math.sqrt(variance);

    if (stdDev > 0.5 && Math.abs(power - mean) > 2.5 * stdDev) {
      anomaly = true;
    }
  }

  window.push(power);
  if (window.length > WINDOW_SIZE) window.shift();

  return { anomaly, mean: mean ? +mean.toFixed(1) : null, stdDev: stdDev ? +stdDev.toFixed(1) : null };
}

module.exports = { checkAnomaly };
