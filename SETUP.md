# IoT Appliances Power Tracker — Full Project

Everything you need: hardware README, live dashboard, and backend API.

## 📁 What's inside

```
├── README.md              → GitHub project README (with photos + circuit diagram)
├── assets/                → Hardware photo + circuit diagram (used by README.md)
├── dashboard/
│   └── index.html         → Live dashboard (open directly in a browser, or served by the backend)
└── backend/
    ├── server.js           → Main API + WebSocket server
    ├── config/appliances.js → Appliance presets (rated/max wattage)
    ├── services/           → Cost & carbon calc, anomaly detection, scheduler
    ├── middleware/auth.js  → Login + route protection
    ├── package.json
    └── .env.example        → Copy to .env and fill in your values
```

## 🚀 Setup (5 minutes)

**1. Install Node.js** (v18+) and **MongoDB** (local install, or a free MongoDB Atlas cluster).

**2. Install dependencies:**
```bash
cd backend
npm install
```

**3. Configure environment:**
```bash
cp .env.example .env
```
Open `.env` and set:
- `MONGO_URI` — your MongoDB connection string
- `JWT_SECRET` — any long random string
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — your login for the dashboard's power/schedule controls

**4. Start the server:**
```bash
npm start
```

**5. Open the dashboard:**
```
http://localhost:3000
```
It works immediately with simulated demo data. Once your ESP32 starts posting real readings to `/api/reading`, it switches to live data automatically.

## 🔌 Connecting your ESP32

Have the firmware POST readings like this every few seconds:
```
POST http://<your-server-ip>:3000/api/reading
Content-Type: application/json

{ "applianceName": "Fan", "power": 62.4, "voltage": 220, "current": 0.28 }
```
`applianceName` must match one of the presets in `backend/config/appliances.js` (Bulb, Fan, AC, TV, Iron, Heater, Refrigerator, Washing Machine, Microwave, Water Heater).

## 📤 Putting it on GitHub

1. Create a new repo on GitHub
2. Copy everything in this folder into it (or `git init` here directly)
3. Commit and push — `README.md` will render automatically with your photos

## ⚠️ Note on `.env`

Never commit your real `.env` file — it holds your database connection string and admin password. A `.gitignore` is included to keep it out of git automatically.
