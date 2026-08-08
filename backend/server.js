// server.js — IoT Power Tracker backend
// Real-time (Socket.io) + auth + anomaly detection + scheduling +
// cost/carbon tracking + CSV/PDF reports, on top of the core
// reading/control/power-save/overload-cutoff API.

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { MongoClient } = require('mongodb');
const PDFDocument = require('pdfkit');

const APPLIANCES = require('./config/appliances');
const { checkAnomaly } = require('./services/anomaly');
const { startScheduler } = require('./services/scheduler');
const { login, requireAuth } = require('./middleware/auth');
const { calculateCost, calculateCarbon, readingsToKWh } = require('./services/cost');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static('../dashboard'));

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const DB_NAME = 'power_tracker';
const READINGS = 'readings';
const STATE = 'appliance_state';

let db;
const inMemoryCollections = new Map();

function matchesFilter(doc, filter = {}) {
  return Object.entries(filter).every(([key, value]) => {
    const actual = doc[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if ('$gte' in value) return actual >= value.$gte;
      if ('$lte' in value) return actual <= value.$lte;
      if ('$in' in value) return value.$in.includes(actual);
      return Object.entries(value).every(([op, val]) => {
        if (op === '$gte') return actual >= val;
        if (op === '$lte') return actual <= val;
        if (op === '$in') return val.includes(actual);
        return actual === val;
      });
    }
    return actual === value;
  });
}

function createCollection(name) {
  if (!inMemoryCollections.has(name)) inMemoryCollections.set(name, []);
  const docs = inMemoryCollections.get(name);

  return {
    async findOne(filter = {}) {
      return docs.find(d => matchesFilter(d, filter)) || null;
    },
    async insertOne(doc) {
      const record = { ...doc };
      docs.push(record);
      return { acknowledged: true, insertedId: docs.length };
    },
    async updateOne(filter = {}, update = {}, options = {}) {
      const existing = docs.find(d => matchesFilter(d, filter));
      if (existing) {
        if (update.$set) Object.assign(existing, update.$set);
        return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
      }
      if (options.upsert) {
        const record = { ...filter };
        if (update.$set) Object.assign(record, update.$set);
        docs.push(record);
        return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: docs.length };
      }
      return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
    },
    find(filter = {}) {
      const baseResults = docs.filter(d => matchesFilter(d, filter));
      let sortSpec = null;
      let limitCount = null;
      const cursor = {
        sort(sortObj) {
          sortSpec = sortObj;
          return cursor;
        },
        limit(n) {
          limitCount = n;
          return cursor;
        },
        async toArray() {
          let results = [...baseResults];
          if (sortSpec) {
            const [[field, direction]] = Object.entries(sortSpec);
            results.sort((a, b) => {
              const aValue = a[field];
              const bValue = b[field];
              if (aValue === bValue) return 0;
              return aValue > bValue ? direction : -direction;
            });
          }
          if (limitCount != null) results = results.slice(0, limitCount);
          return results;
        }
      };
      return cursor;
    }
  };
}

async function connectDB() {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    db = client.db(DB_NAME);
    console.log('✅ Connected to MongoDB');
  } catch (err) {
    console.warn('⚠️ MongoDB connection failed; using in-memory fallback database:', err.message);
    db = {
      collection(name) {
        return createCollection(name);
      }
    };
  }
}

async function getState(applianceName) {
  let state = await db.collection(STATE).findOne({ applianceName });
  if (!state) {
    state = { applianceName, isOn: true, powerSave: false, lastOverload: null };
    await db.collection(STATE).insertOne(state);
  }
  return state;
}

// ---------------- Auth ----------------
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const token = login(email, password);
  if (!token) return res.status(401).json({ error: 'invalid credentials' });
  res.json({ token });
});

// ---------------- Appliances ----------------
app.get('/api/appliances', async (req, res) => {
  const result = [];
  for (const name of Object.keys(APPLIANCES)) {
    const state = await getState(name);
    result.push({ name, ...APPLIANCES[name], ...state });
  }
  res.json(result);
});

// ---------------- Readings (ingest from ESP32) ----------------
app.post('/api/reading', async (req, res) => {
  try {
    const { applianceName, power, voltage, current } = req.body;
    const profile = APPLIANCES[applianceName];
    if (!profile) return res.status(400).json({ error: 'unknown applianceName' });
    if (typeof power !== 'number') return res.status(400).json({ error: 'power must be a number' });

    const state = await getState(applianceName);
    if (!state.isOn) return res.status(409).json({ error: 'appliance is off — reading rejected' });

    const overload = power > profile.maxW;
    const { anomaly, mean, stdDev } = checkAnomaly(applianceName, power);

    const doc = {
      applianceName, power,
      voltage: voltage ?? null,
      current: current ?? +(power / 220).toFixed(2),
      powerSave: state.powerSave,
      overload, anomaly,
      time: new Date()
    };
    await db.collection(READINGS).insertOne(doc);

    if (overload) {
      await db.collection(STATE).updateOne({ applianceName }, { $set: { isOn: false, lastOverload: new Date() } });
    }

    // push to every connected dashboard in real time
    io.emit('reading', { ...doc, isOn: !overload, anomalyMean: mean, anomalyStdDev: stdDev });
    if (overload) io.emit('overload', { applianceName, power, limit: profile.maxW });
    if (anomaly && !overload) io.emit('anomaly', { applianceName, power, mean, stdDev });

    res.status(201).json({ ok: true, overload, anomaly, cutoff: overload });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to store reading' });
  }
});

// ---------------- Control (protected) ----------------
app.post('/api/control', requireAuth, async (req, res) => {
  const { applianceName, action } = req.body;
  if (!APPLIANCES[applianceName]) return res.status(400).json({ error: 'unknown applianceName' });
  if (!['on', 'off'].includes(action)) return res.status(400).json({ error: "action must be 'on' or 'off'" });

  await getState(applianceName);
  await db.collection(STATE).updateOne(
    { applianceName },
    { $set: { isOn: action === 'on', ...(action === 'on' ? { lastOverload: null } : {}) } }
  );
  io.emit('state-change', { applianceName, isOn: action === 'on' });
  res.json({ ok: true, applianceName, isOn: action === 'on' });
});

app.post('/api/power-save', requireAuth, async (req, res) => {
  const { applianceName, enabled } = req.body;
  if (!APPLIANCES[applianceName]) return res.status(400).json({ error: 'unknown applianceName' });
  await getState(applianceName);
  await db.collection(STATE).updateOne({ applianceName }, { $set: { powerSave: !!enabled } });
  io.emit('state-change', { applianceName, powerSave: !!enabled });
  res.json({ ok: true, applianceName, powerSave: !!enabled });
});

// ---------------- Scheduling (protected) ----------------
// Body: { applianceName, offAt: "23:00" }
app.post('/api/schedule', requireAuth, async (req, res) => {
  const { applianceName, offAt } = req.body;
  if (!APPLIANCES[applianceName]) return res.status(400).json({ error: 'unknown applianceName' });
  if (!/^\d{2}:\d{2}$/.test(offAt)) return res.status(400).json({ error: 'offAt must be HH:MM (24h)' });

  await db.collection('schedules').updateOne(
    { applianceName },
    { $set: { applianceName, offAt, active: true } },
    { upsert: true }
  );
  res.json({ ok: true, applianceName, offAt });
});

app.delete('/api/schedule/:applianceName', requireAuth, async (req, res) => {
  await db.collection('schedules').updateOne(
    { applianceName: req.params.applianceName },
    { $set: { active: false } }
  );
  res.json({ ok: true });
});

// ---------------- Live status / history ----------------
app.get('/api/live-status', async (req, res) => {
  const { name } = req.query;
  const filter = name ? { applianceName: name } : {};
  const latest = await db.collection(READINGS).find(filter).sort({ time: -1 }).limit(1).toArray();
  const state = name ? await getState(name) : null;

  if (!latest.length) {
    return res.json({ applianceName: name || null, power: 0, efficiency: 0, uptime: 0, isOn: state?.isOn ?? true, powerSave: state?.powerSave ?? false });
  }

  const first = await db.collection(READINGS).find(filter).sort({ time: 1 }).limit(1).toArray();
  const uptimeDays = Math.floor((Date.now() - new Date(first[0].time)) / 86400000);
  const efficiency = state?.powerSave ? Math.round(85 + Math.random() * 10) : Math.round(70 + Math.random() * 20);

  res.json({
    applianceName: latest[0].applianceName, power: latest[0].power, efficiency, uptime: uptimeDays,
    isOn: state?.isOn ?? true, powerSave: state?.powerSave ?? false, overload: latest[0].overload
  });
});

app.get('/api/history', async (req, res) => {
  const { name } = req.query;
  const limit = parseInt(req.query.limit) || 30;
  const filter = name ? { applianceName: name } : {};
  const docs = await db.collection(READINGS).find(filter).sort({ time: -1 }).limit(limit).toArray();
  res.json(docs.reverse());
});

// ---------------- Cost & carbon ----------------
app.get('/api/cost', async (req, res) => {
  const { name } = req.query;
  const filter = name ? { applianceName: name } : {};
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const readings = await db.collection(READINGS).find({ ...filter, time: { $gte: monthAgo } }).toArray();

  const kWh = readingsToKWh(readings, 3);
  res.json({
    applianceName: name || 'all',
    kWhThisMonth: +kWh.toFixed(2),
    estimatedCost: calculateCost(kWh),
    estimatedCarbonKg: calculateCarbon(kWh)
  });
});

// ---------------- Reports ----------------
app.get('/api/report/csv', async (req, res) => {
  const { name } = req.query;
  const filter = name ? { applianceName: name } : {};
  const docs = await db.collection(READINGS).find(filter).sort({ time: 1 }).toArray();

  const rows = ['applianceName,power,voltage,current,overload,anomaly,time'];
  docs.forEach(d => rows.push(`${d.applianceName},${d.power},${d.voltage ?? ''},${d.current ?? ''},${d.overload},${d.anomaly ?? false},${d.time.toISOString()}`));

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="readings-${name || 'all'}.csv"`);
  res.send(rows.join('\n'));
});

app.get('/api/report/pdf', async (req, res) => {
  const { name } = req.query;
  const filter = name ? { applianceName: name } : {};
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const docs = await db.collection(READINGS).find({ ...filter, time: { $gte: monthAgo } }).toArray();
  const kWh = readingsToKWh(docs, 3);

  const doc = new PDFDocument({ margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="report-${name || 'all'}.pdf"`);
  doc.pipe(res);

  doc.fontSize(20).text('IoT Power Tracker — Monthly Report', { align: 'center' }).moveDown();
  doc.fontSize(12).text(`Appliance: ${name || 'All appliances'}`);
  doc.text(`Period: last 30 days`);
  doc.text(`Total energy used: ${kWh.toFixed(2)} kWh`);
  doc.text(`Estimated cost: Rs.${calculateCost(kWh)}`);
  doc.text(`Estimated carbon footprint: ${calculateCarbon(kWh)} kg CO2`);
  doc.moveDown().fontSize(10).fillColor('gray')
    .text(`Generated ${new Date().toLocaleString()} - ${docs.length} readings analyzed`);

  doc.end();
});

// ---------------- Sockets ----------------
io.on('connection', socket => {
  console.log('📡 Dashboard connected:', socket.id);
});

const PORT = process.env.PORT || 3000;
connectDB().then(() => {
  startScheduler(db);
  server.listen(PORT, () => console.log(`🚀 Dashboard + API + WebSocket running on port ${PORT}`));
});
