// Appliance profiles: normal running draw (ratedW) and the safety
// ceiling (maxW) that trips an automatic relay cutoff.
module.exports = {
  'Bulb':            { ratedW: 10,   maxW: 18   },
  'Fan':              { ratedW: 65,   maxW: 90   },
  'AC':                { ratedW: 1400, maxW: 1800 },
  'TV':                { ratedW: 90,   maxW: 150  },
  'Iron':              { ratedW: 1200, maxW: 1800 },
  'Heater':            { ratedW: 1600, maxW: 2200 },
  'Refrigerator':      { ratedW: 150,  maxW: 250  },
  'Washing Machine':   { ratedW: 600,  maxW: 1000 },
  'Microwave':         { ratedW: 1000, maxW: 1500 },
  'Water Heater':      { ratedW: 2000, maxW: 3000 }
};
