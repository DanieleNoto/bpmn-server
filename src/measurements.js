'use strict';
const { WebSocketServer, WebSocket } = require('ws');
const { randomUUID } = require('crypto');

module.exports = function attachMeasurements(app, server, apiKey) {
  let session = randomUUID();
  const points = [];
  let sequence = 0;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/api/measurements/live' || (apiKey && req.headers['x-api-key'] !== apiKey)) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    ws.on('error', () => {});
    ws.send(JSON.stringify({ session, points }));
  });
  app.post('/api/measurements', require('express').json({ limit: '4kb' }), (req, res) => {
    const { value, series = 'valore' } = req.body || {};
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e9 || series !== 'valore')
      return res.status(400).json({ error: 'Inserisci un numero finito tra -1e9 e 1e9; serie: valore.' });
    const point = { id: ++sequence, value, time: Date.now() };
    points.push(point); if (points.length > 200) points.shift();
    broadcast({ session, points: [point] });
    res.status(201).json(point);
  });
  // Reset: svuota il grafico e cambia sessione, così i client ripartono da zero
  app.delete('/api/measurements', (_req, res) => {
    points.length = 0; sequence = 0; session = randomUUID();
    broadcast({ session, points: [], reset: true });
    res.json({ session });
  });
  function broadcast(payload) {
    const message = JSON.stringify(payload);
    for (const ws of wss.clients) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (ws.bufferedAmount > 65536) { ws.terminate(); continue; }
      ws.send(message);
    }
  }
};
