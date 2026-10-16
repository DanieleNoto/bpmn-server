'use strict';
/**
 * Server del grafico live per Unity / Meta Quest 3.
 * La pagina /live invia valori; il visore li riceve in tempo reale via WebSocket (/api/measurements/live).
 */
const os = require('os');
const path = require('path');
const express = require('express');

const config = {
  host: process.env.HOST || '0.0.0.0',
  port: parseInt(process.env.PORT || '3000', 10),
  apiKey: process.env.API_KEY || '',              // se impostata, richiesta via header X-Api-Key
  corsOrigin: process.env.CORS_ORIGIN || '*',
};

const app = express();
const server = require('http').createServer(app);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', config.corsOrigin);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use((req, _res, next) => { console.log(`${new Date().toISOString()} ${req.ip} ${req.method} ${req.originalUrl}`); next(); });

app.get('/', (_req, res) => res.redirect('/live'));
app.get('/live', (_req, res) => res.sendFile(path.join(__dirname, '..', 'live.html')));
app.get('/api/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// Autenticazione opzionale
app.use('/api', (req, res, next) => {
  if (!config.apiKey) return next();
  const key = req.get('X-Api-Key') || req.query.apiKey;
  if (key === config.apiKey) return next();
  res.status(401).json({ error: 'API key mancante o non valida (header X-Api-Key)' });
});

require('./measurements')(app, server, config.apiKey);

app.use((_req, res) => res.status(404).json({ error: 'Endpoint non trovato' }));

server.listen(config.port, config.host, () => {
  console.log(`\nServer grafico live in ascolto su http://${config.host}:${config.port}`);
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal);
  for (const i of ips) {
    console.log(`  -> pagina invio: http://${i.address}:${config.port}/live`);
    console.log(`  -> dal Quest:    ws://${i.address}:${config.port}/api/measurements/live`);
  }
  console.log(`  API key: ${config.apiKey ? 'attiva' : 'disattivata'}\n`);
});
