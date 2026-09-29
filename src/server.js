'use strict';
/**
 * BPMN API server per Unity / Meta Quest 3.
 * Il client riceve JSON già parsato e lo tiene solo in RAM (nessun file su disco lato visore).
 */
const os = require('os');
const path = require('path');
const express = require('express');
const { DiagramStore } = require('./store');

const config = {
  host: process.env.HOST || '0.0.0.0',
  port: parseInt(process.env.PORT || '3000', 10),
  bpmnDir: process.env.BPMN_DIR || path.join(__dirname, '..', 'bpmn'),
  apiKey: process.env.API_KEY || '',              // se impostata, richiesta via header X-Api-Key
  persistUploads: process.env.PERSIST_UPLOADS !== 'false',
  maxUploadSize: process.env.MAX_UPLOAD_SIZE || '20mb',
  corsOrigin: process.env.CORS_ORIGIN || '*',
};

const store = new DiagramStore(config.bpmnDir, { persist: config.persistUploads });
store.loadAll();
store.watch();

const app = express();
app.disable('x-powered-by');
app.set('etag', 'strong'); // permette a Unity di usare If-None-Match -> 304

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', config.corsOrigin);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key, If-None-Match');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'ETag, X-Diagram-Hash');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use((req, _res, next) => { console.log(`${new Date().toISOString()} ${req.ip} ${req.method} ${req.originalUrl}`); next(); });

app.get('/api/health', (_req, res) => res.json({ status: 'ok', diagrams: store.items.size, time: new Date().toISOString() }));

// Autenticazione opzionale
app.use('/api', (req, res, next) => {
  if (!config.apiKey) return next();
  const key = req.get('X-Api-Key') || req.query.apiKey;
  if (key === config.apiKey) return next();
  res.status(401).json({ error: 'API key mancante o non valida (header X-Api-Key)' });
});

const requireItem = (req, res, next) => {
  const item = store.get(req.params.id);
  if (!item) return res.status(404).json({ error: `Diagramma '${req.params.id}' non trovato` });
  req.item = item;
  next();
};

/** Elenco diagrammi disponibili */
app.get('/api/diagrams', (_req, res) => res.json({ diagrams: store.list() }));

/** Diagramma parsato (JSON render-ready). ?plane=N per i piani secondari (es. sottoprocessi collassati) */
app.get('/api/diagrams/:id', requireItem, (req, res) => {
  const planeIndex = parseInt(req.query.plane || '0', 10) || 0;
  try {
    const parsed = store.getParsed(req.item.id, planeIndex);
    res.setHeader('X-Diagram-Hash', req.item.hash);
    res.setHeader('Cache-Control', 'no-cache');
    res.json({
      id: req.item.id,
      fileName: req.item.fileName,
      hash: req.item.hash,
      updatedAt: req.item.updatedAt,
      ...parsed,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Solo metadati leggeri: utile per sapere se il diagramma è cambiato senza scaricarlo */
app.get('/api/diagrams/:id/meta', requireItem, (req, res) => {
  const p = store.getParsed(req.item.id, 0);
  res.json({ id: req.item.id, hash: req.item.hash, updatedAt: req.item.updatedAt, planes: p.planes, stats: p.stats, bounds: p.bounds });
});

/** XML originale */
app.get('/api/diagrams/:id/raw', requireItem, (req, res) => {
  res.type('application/xml').send(req.item.xml);
});

/** Carica/sostituisce un diagramma: body = XML BPMN (Content-Type application/xml o text/plain) */
const rawBody = express.text({ type: ['application/xml', 'text/xml', 'text/plain', 'application/octet-stream', '*/*'], limit: config.maxUploadSize });
const upsert = (req, res) => {
  const id = req.params.id;
  if (!DiagramStore.isValidId(id)) return res.status(400).json({ error: 'id non valido (usa lettere, numeri, . _ -)' });
  if (!req.body || typeof req.body !== 'string') return res.status(400).json({ error: 'Body XML mancante' });
  try {
    const existed = !!store.get(id);
    const item = store.set(id, req.body);
    res.status(existed ? 200 : 201).json({ id: item.id, hash: item.hash, stats: item.planes.get(0).stats, warnings: item.planes.get(0).warnings });
  } catch (err) {
    res.status(422).json({ error: `BPMN non valido: ${err.message}` });
  }
};
app.put('/api/diagrams/:id', rawBody, upsert);
app.post('/api/diagrams/:id', rawBody, upsert);

app.delete('/api/diagrams/:id', requireItem, (req, res) => {
  store.delete(req.item.id);
  res.sendStatus(204);
});

app.use((_req, res) => res.status(404).json({ error: 'Endpoint non trovato' }));

app.listen(config.port, config.host, () => {
  console.log(`\nBPMN server in ascolto su http://${config.host}:${config.port}`);
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal);
  for (const i of ips) console.log(`  -> dal Quest usa: http://${i.address}:${config.port}/api/diagrams`);
  console.log(`  API key: ${config.apiKey ? 'attiva' : 'disattivata'} | cartella: ${store.dir}\n`);
});
