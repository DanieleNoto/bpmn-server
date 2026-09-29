'use strict';
/**
 * Archivio in memoria dei diagrammi.
 * Carica i .bpmn dalla cartella BPMN_DIR, li parsa una volta e tiene tutto in RAM.
 * La cartella viene osservata: se sostituisci/modifichi un file, viene riparsato.
 */
const fs = require('fs');
const path = require('path');
const { parseBpmn, hashOf } = require('./bpmnParser');

const SAFE_ID = /^[A-Za-z0-9._-]{1,100}$/;

class DiagramStore {
  constructor(dir, { persist = true, log = console } = {}) {
    this.dir = path.resolve(dir);
    this.persist = persist;
    this.log = log;
    this.items = new Map(); // id -> { id, fileName, xml, hash, updatedAt, planes: Map<planeIndex, parsed>, error }
    this._timers = new Map();
  }

  static isValidId(id) { return SAFE_ID.test(id); }
  static idFromFile(file) { return path.basename(file, path.extname(file)).replace(/[^A-Za-z0-9._-]/g, '_'); }

  loadAll() {
    fs.mkdirSync(this.dir, { recursive: true });
    for (const f of fs.readdirSync(this.dir)) if (/\.(bpmn|xml)$/i.test(f)) this.loadFile(f);
    this.log.info(`[store] ${this.items.size} diagrammi caricati da ${this.dir}`);
  }

  loadFile(fileName) {
    const full = path.join(this.dir, fileName);
    const id = DiagramStore.idFromFile(fileName);
    if (!fs.existsSync(full)) {
      if (this.items.delete(id)) this.log.info(`[store] rimosso ${id}`);
      return;
    }
    try {
      this.set(id, fs.readFileSync(full, 'utf8'), { fileName, persist: false });
    } catch (err) {
      this.log.error(`[store] errore su ${fileName}: ${err.message}`);
    }
  }

  /** Inserisce/aggiorna un diagramma. Lancia se l'XML non è valido. */
  set(id, xml, { fileName = `${id}.bpmn`, persist = this.persist } = {}) {
    const main = parseBpmn(xml, { planeIndex: 0 }); // valida subito
    const hash = hashOf(xml);
    const prev = this.items.get(id);
    if (prev && prev.hash === hash) return prev;
    const item = {
      id, fileName, xml, hash,
      updatedAt: new Date().toISOString(),
      planes: new Map([[0, main]]),
    };
    this.items.set(id, item);
    if (persist) {
      fs.writeFileSync(path.join(this.dir, fileName), xml, 'utf8');
    }
    this.log.info(`[store] ${prev ? 'aggiornato' : 'caricato'} ${id} (${main.stats.nodes} nodi, ${main.stats.edges} archi)`);
    return item;
  }

  delete(id, { persist = this.persist } = {}) {
    const item = this.items.get(id);
    if (!item) return false;
    this.items.delete(id);
    if (persist) {
      const full = path.join(this.dir, item.fileName);
      if (fs.existsSync(full)) fs.unlinkSync(full);
    }
    return true;
  }

  get(id) { return this.items.get(id); }

  /** JSON parsato per un determinato plane (cache lazy). */
  getParsed(id, planeIndex = 0) {
    const item = this.items.get(id);
    if (!item) return null;
    if (!item.planes.has(planeIndex)) item.planes.set(planeIndex, parseBpmn(item.xml, { planeIndex }));
    return item.planes.get(planeIndex);
  }

  list() {
    return [...this.items.values()].map((it) => {
      const p = it.planes.get(0);
      return {
        id: it.id, fileName: it.fileName, hash: it.hash, updatedAt: it.updatedAt,
        name: p.participants[0]?.name || p.processes[0]?.name || it.id,
        planeCount: p.planes.length, stats: p.stats,
      };
    });
  }

  watch() {
    try {
      fs.watch(this.dir, (_evt, fileName) => {
        if (!fileName || !/\.(bpmn|xml)$/i.test(fileName)) return;
        clearTimeout(this._timers.get(fileName));
        this._timers.set(fileName, setTimeout(() => this.loadFile(fileName), 300));
      });
      this.log.info(`[store] watch attivo su ${this.dir}`);
    } catch (err) {
      this.log.warn(`[store] watch non disponibile: ${err.message}`);
    }
  }
}

module.exports = { DiagramStore };
