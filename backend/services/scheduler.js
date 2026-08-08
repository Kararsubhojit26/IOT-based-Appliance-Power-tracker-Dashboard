// Two recurring jobs:
// 1. Every minute — checks scheduled auto-off times and switches
//    matching appliances off (e.g. "turn the heater off at 23:00").
// 2. Every hour — rolls raw readings older than 24h into hourly
//    aggregates, so the readings collection doesn't grow forever
//    while historical trends/reports stay available.

const cron = require('node-cron');

function startScheduler(db) {
  // ---- auto-off schedules ----
  cron.schedule('* * * * *', async () => {
    const now = new Date();
    const hhmm = now.toTimeString().slice(0, 5); // "23:00"

    const due = await db.collection('schedules').find({ offAt: hhmm, active: true }).toArray();
    for (const sched of due) {
      await db.collection('appliance_state').updateOne(
        { applianceName: sched.applianceName },
        { $set: { isOn: false } }
      );
      console.log(`⏰ Scheduled auto-off: ${sched.applianceName} at ${hhmm}`);
    }
  });

  // ---- hourly rollup ----
  cron.schedule('0 * * * *', async () => {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const old = await db.collection('readings').find({ time: { $lt: cutoff } }).toArray();
    if (!old.length) return;

    const byApplianceHour = {};
    for (const r of old) {
      const hourKey = `${r.applianceName}|${r.time.toISOString().slice(0, 13)}`;
      if (!byApplianceHour[hourKey]) byApplianceHour[hourKey] = [];
      byApplianceHour[hourKey].push(r.power);
    }

    const aggregates = Object.entries(byApplianceHour).map(([key, powers]) => {
      const [applianceName, hour] = key.split('|');
      return {
        applianceName,
        hour: new Date(hour + ':00:00Z'),
        avgPower: +(powers.reduce((a, b) => a + b, 0) / powers.length).toFixed(1),
        maxPower: Math.max(...powers),
        sampleCount: powers.length
      };
    });

    if (aggregates.length) {
      await db.collection('hourly_aggregates').insertMany(aggregates);
      await db.collection('readings').deleteMany({ time: { $lt: cutoff } });
      console.log(`📦 Rolled up ${old.length} readings into ${aggregates.length} hourly aggregates`);
    }
  });

  console.log('🕒 Scheduler started (auto-off + hourly rollups)');
}

module.exports = { startScheduler };
