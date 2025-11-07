// server.js
const express = require('express');
const cors = require('cors');
const { decide } = require('./src/agent'); // keep if you have src/agent.js

const app = express();

// --- CORS: allow the hosted game + local game (if you ever use it)
const ALLOWED_ORIGINS = new Set([
  'https://5f963517-713a-4b2c-b19a-dc6b4d0933bf.vercel.app',
  'http://localhost:8080'
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || ALLOWED_ORIGINS.has(origin)) {
    res.header('Access-Control-Allow-Origin', origin || '*');
  }
  res.header('Vary', 'Origin'); // for caches/CDN correctness
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  // some browsers send credentials=false but adding this is harmless; remove if not needed
  res.header('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(204); // preflight OK
  next();
});

app.use(express.json());

app.get('/', (_req, res) => res.send('wildfire-bot: ok'));

app.post('/turn', (req, res) => {
  try {
    const state = req.body || {};
    const out = decide(state);
    res.json(out);
  } catch (e) {
    console.error('Error in /turn:', e);
    res.json({ move: { direction: 0, speed: 0 }, debugPoints: [] });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot listening on http://localhost:${PORT}`));
