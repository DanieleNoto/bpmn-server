'use strict';
/**
 * BPMN 2.0 XML -> JSON "render-ready" per Unity.
 *
 * Output pensato per JsonUtility di Unity:
 *  - solo array (niente dizionari)
 *  - nessun null: stringhe vuote, 0, false, [] come default
 *  - coordinate BPMN originali (origine in alto a sinistra, Y verso il basso)
 */
const { XMLParser } = require('fast-xml-parser');
const crypto = require('crypto');

const TASK_TYPES = new Set([
  'task', 'userTask', 'serviceTask', 'scriptTask', 'manualTask', 'sendTask',
  'receiveTask', 'businessRuleTask', 'callActivity',
]);
const SUBPROCESS_TYPES = new Set(['subProcess', 'transaction', 'adHocSubProcess']);
const EVENT_TYPES = new Set([
  'startEvent', 'endEvent', 'intermediateCatchEvent', 'intermediateThrowEvent',
  'boundaryEvent', 'implicitThrowEvent',
]);
const GATEWAY_TYPES = new Set([
  'exclusiveGateway', 'parallelGateway', 'inclusiveGateway',
  'eventBasedGateway', 'complexGateway',
]);
const DATA_TYPES = new Set(['dataObjectReference', 'dataStoreReference', 'dataInput', 'dataOutput']);
const ARTIFACT_TYPES = new Set(['textAnnotation', 'group']);

const EVENT_DEFINITIONS = [
  'message', 'timer', 'error', 'escalation', 'cancel', 'compensate',
  'conditional', 'link', 'signal', 'terminate',
];

// attributi/figli BPMN standard: tutto il resto (es. camunda:topic) finisce in `properties`
const STANDARD_KEYS = new Set([
  'id', 'name', 'default', 'attachedToRef', 'cancelActivity', 'isInterrupting', 'triggeredByEvent',
  'calledElement', 'implementation', 'isForCompensation', 'startQuantity', 'completionQuantity',
  'dataObjectRef', 'dataStoreRef', 'instantiate', 'eventGatewayType', 'gatewayDirection', 'method',
  'textFormat', 'incoming', 'outgoing', 'documentation', 'text', 'extensionElements',
  'sourceRef', 'targetRef', 'associationDirection', 'isImmediate', 'itemSubjectRef',
]);

const arr = (v) => (v === undefined || v === null || v === '' ? [] : Array.isArray(v) ? v : [v]);
const str = (v) => (v === undefined || v === null ? '' : typeof v === 'object' ? String(v['#text'] ?? '') : String(v));
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const bool = (v, def = false) => (v === undefined || v === '' ? def : String(v).toLowerCase() === 'true');
const round = (n) => Math.round(n * 100) / 100;

/** Estensioni (Camunda, custom namespace...) appiattite in coppie chiave/valore. */
function extractProperties(el) {
  const out = [];
  for (const [k, v] of Object.entries(el)) {
    if (!STANDARD_KEYS.has(k) && typeof v === 'string' && !k.endsWith('EventDefinition')) out.push({ key: k, value: v });
  }
  const walk = (node, prefix) => {
    for (const [k, v] of Object.entries(node)) {
      for (const item of arr(v)) {
        const base = prefix ? `${prefix}.${k}` : k;
        if (typeof item !== 'object') { out.push({ key: base, value: str(item) }); continue; }
        const tag = item.name ?? item.event ?? item.id;
        const key = tag !== undefined ? `${base}[${tag}]` : base;
        if (item['#text'] !== undefined) out.push({ key, value: String(item['#text']) });
        const rest = {};
        for (const [ck, cv] of Object.entries(item)) {
          if (ck === '#text' || ck === 'name' || ck === 'event' || ck === 'id') continue;
          rest[ck] = cv;
        }
        walk(rest, key);
      }
    }
  };
  if (el.extensionElements && typeof el.extensionElements === 'object') walk(el.extensionElements, '');
  return out;
}

function categoryOf(type) {
  if (EVENT_TYPES.has(type)) return 'event';
  if (TASK_TYPES.has(type)) return 'task';
  if (SUBPROCESS_TYPES.has(type)) return 'subprocess';
  if (GATEWAY_TYPES.has(type)) return 'gateway';
  if (DATA_TYPES.has(type)) return 'data';
  if (ARTIFACT_TYPES.has(type)) return 'artifact';
  return '';
}

function emptyBounds() { return { x: 0, y: 0, width: 0, height: 0 }; }
function readBounds(b) {
  if (!b || typeof b !== 'object') return emptyBounds();
  return { x: num(b.x), y: num(b.y), width: num(b.width), height: num(b.height) };
}

function createXmlParser() {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    removeNSPrefix: true,
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: true,
    htmlEntities: true,
    textNodeName: '#text',
  });
}

/**
 * @param {string} xml   contenuto del file .bpmn
 * @param {object} opts  { planeIndex: number }
 */
function parseBpmn(xml, opts = {}) {
  const planeIndex = Number.isInteger(opts.planeIndex) ? opts.planeIndex : 0;
  const warnings = [];
  const doc = createXmlParser().parse(xml);
  const defs = doc.definitions;
  if (!defs) throw new Error('Elemento <definitions> non trovato: non sembra un file BPMN 2.0');

  const nodes = [];
  const edges = [];
  const lanes = [];
  const participants = [];
  const processes = [];
  const nodeById = new Map();
  const edgeById = new Map();
  const laneOfNode = new Map();
  const defaultFlows = new Set();

  const addNode = (n) => { if (!nodeById.has(n.id)) { nodeById.set(n.id, n); nodes.push(n); } };
  const addEdge = (e) => { if (!edgeById.has(e.id)) { edgeById.set(e.id, e); edges.push(e); } };

  const baseShape = () => ({
    x: 0, y: 0, width: 0, height: 0,
    hasShape: false, isExpanded: false, isHorizontal: true,
    hasLabel: false, label: emptyBounds(),
  });

  // ---- Lanes (ricorsive) ----
  function walkLaneSet(laneSet, processId, parentLaneId) {
    for (const ls of arr(laneSet)) {
      for (const lane of arr(ls.lane)) {
        const id = str(lane.id);
        lanes.push({ id, name: str(lane.name), processId, parentLaneId, ...baseShape() });
        for (const ref of arr(lane.flowNodeRef)) laneOfNode.set(str(ref), id);
        walkLaneSet(lane.childLaneSet, processId, id);
      }
    }
  }

  // ---- Elementi di flusso (ricorsivi per i sottoprocessi) ----
  function walkContainer(container, processId, parentId) {
    for (const [tag, value] of Object.entries(container)) {
      if (tag === 'laneSet' || tag === 'extensionElements' || tag === 'documentation') continue;
      if (typeof value !== 'object' && value !== '') continue;

      if (tag === 'sequenceFlow') {
        for (const f of arr(value)) {
          addEdge({
            id: str(f.id), type: 'sequenceFlow', name: str(f.name),
            sourceId: str(f.sourceRef), targetId: str(f.targetRef),
            condition: str(f.conditionExpression), isDefault: false,
            processId, parentId, waypoints: [], hasShape: false, hasLabel: false, label: emptyBounds(),
          });
        }
        continue;
      }
      if (tag === 'association') {
        for (const a of arr(value)) {
          addEdge({
            id: str(a.id), type: 'association', name: '',
            sourceId: str(a.sourceRef), targetId: str(a.targetRef),
            condition: '', isDefault: false, direction: str(a.associationDirection) || 'None',
            processId, parentId, waypoints: [], hasShape: false, hasLabel: false, label: emptyBounds(),
          });
        }
        continue;
      }

      const category = categoryOf(tag);
      if (!category) continue;

      for (const el of arr(value)) {
        const e = typeof el === 'object' ? el : {};
        const id = str(e.id);
        if (!id) continue;

        let eventDefinition = '';
        if (category === 'event') {
          const found = EVENT_DEFINITIONS.filter((d) => `${d}EventDefinition` in e);
          eventDefinition = found.length > 1 ? 'multiple' : (found[0] || 'none');
        }

        const node = {
          id, type: tag, category, eventDefinition,
          name: str(e.name),
          documentation: arr(e.documentation).map(str).join('\n'),
          text: tag === 'textAnnotation' ? str(e.text) : '',
          processId, parentId, laneId: '', laneName: '',
          attachedToRef: str(e.attachedToRef),
          cancelActivity: bool(e.cancelActivity, true),
          isInterrupting: bool(e.isInterrupting, true),
          triggeredByEvent: bool(e.triggeredByEvent),
          isLoop: 'standardLoopCharacteristics' in e,
          isMultiInstance: 'multiInstanceLoopCharacteristics' in e,
          isSequential: bool(e.multiInstanceLoopCharacteristics?.isSequential),
          calledElement: str(e.calledElement),
          incoming: arr(e.incoming).map(str),
          outgoing: arr(e.outgoing).map(str),
          properties: extractProperties(e),
          ...baseShape(),
        };
        if (e.default) defaultFlows.add(str(e.default));
        addNode(node);

        // associazioni dati dentro le attività
        for (const da of arr(e.dataInputAssociation)) {
          for (const src of arr(da.sourceRef)) {
            addEdge({
              id: str(da.id), type: 'dataInputAssociation', name: '',
              sourceId: str(src), targetId: id, condition: '', isDefault: false,
              processId, parentId, waypoints: [], hasShape: false, hasLabel: false, label: emptyBounds(),
            });
          }
        }
        for (const da of arr(e.dataOutputAssociation)) {
          addEdge({
            id: str(da.id), type: 'dataOutputAssociation', name: '',
            sourceId: id, targetId: str(da.targetRef), condition: '', isDefault: false,
            processId, parentId, waypoints: [], hasShape: false, hasLabel: false, label: emptyBounds(),
          });
        }

        if (category === 'subprocess') walkContainer(e, processId, id);
      }
    }
  }

  // ---- Processi ----
  for (const p of arr(defs.process)) {
    const pid = str(p.id);
    processes.push({ id: pid, name: str(p.name), isExecutable: bool(p.isExecutable) });
    walkLaneSet(p.laneSet, pid, '');
    walkContainer(p, pid, '');
  }

  // ---- Collaborazione: pool e message flow ----
  for (const c of arr(defs.collaboration)) {
    for (const part of arr(c.participant)) {
      participants.push({
        id: str(part.id), name: str(part.name), processId: str(part.processRef), ...baseShape(),
      });
    }
    for (const mf of arr(c.messageFlow)) {
      addEdge({
        id: str(mf.id), type: 'messageFlow', name: str(mf.name),
        sourceId: str(mf.sourceRef), targetId: str(mf.targetRef), condition: '', isDefault: false,
        processId: '', parentId: '', waypoints: [], hasShape: false, hasLabel: false, label: emptyBounds(),
      });
    }
    // annotazioni/associazioni a livello di collaborazione
    walkContainer({ textAnnotation: c.textAnnotation, group: c.group, association: c.association }, '', '');
  }

  const laneNames = new Map(lanes.map((l) => [l.id, l.name]));
  for (const n of nodes) { n.laneId = laneOfNode.get(n.id) || ''; n.laneName = laneNames.get(n.laneId) || ''; }
  // collega le annotazioni ai nodi (comodo per mostrarle come tooltip in VR)
  for (const n of nodes) n.annotations = [];
  for (const e of edges) {
    if (e.type !== 'association') continue;
    const a = nodeById.get(e.sourceId), b = nodeById.get(e.targetId);
    if (b?.type === 'textAnnotation' && a) a.annotations.push(b.text);
    else if (a?.type === 'textAnnotation' && b) b.annotations.push(a.text);
  }
  for (const e of edges) if (defaultFlows.has(e.id)) e.isDefault = true;

  // ---- Diagram Interchange (layout) ----
  const diagrams = arr(defs.BPMNDiagram);
  const planes = diagrams.map((d, i) => ({
    index: i, id: str(d.id), name: str(d.name), bpmnElement: str(d.BPMNPlane?.bpmnElement),
  }));
  if (!diagrams.length) warnings.push('Nessun BPMNDiagram: il file non contiene layout grafico.');
  const plane = diagrams[planeIndex]?.BPMNPlane;
  if (diagrams.length && !plane) warnings.push(`Plane ${planeIndex} inesistente (disponibili: ${diagrams.length}).`);

  const shapeTargets = new Map();
  for (const x of nodes) shapeTargets.set(x.id, x);
  for (const x of lanes) shapeTargets.set(x.id, x);
  for (const x of participants) shapeTargets.set(x.id, x);

  for (const s of arr(plane?.BPMNShape)) {
    const target = shapeTargets.get(str(s.bpmnElement));
    if (!target) { warnings.push(`Shape senza elemento: ${str(s.bpmnElement)}`); continue; }
    Object.assign(target, readBounds(s.Bounds));
    target.hasShape = true;
    target.isExpanded = bool(s.isExpanded);
    target.isHorizontal = s.isHorizontal === undefined ? true : bool(s.isHorizontal);
    if (s.BPMNLabel?.Bounds) { target.hasLabel = true; target.label = readBounds(s.BPMNLabel.Bounds); }
  }
  for (const d of arr(plane?.BPMNEdge)) {
    const target = edgeById.get(str(d.bpmnElement));
    if (!target) { warnings.push(`Edge senza elemento: ${str(d.bpmnElement)}`); continue; }
    target.waypoints = arr(d.waypoint).map((w) => ({ x: num(w.x), y: num(w.y) }));
    target.hasShape = target.waypoints.length > 0;
    if (d.BPMNLabel?.Bounds) { target.hasLabel = true; target.label = readBounds(d.BPMNLabel.Bounds); }
  }

  // ---- Bounding box complessivo ----
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x, y, w = 0, h = 0) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
  };
  for (const s of [...nodes, ...lanes, ...participants]) if (s.hasShape) grow(s.x, s.y, s.width, s.height);
  for (const e of edges) for (const w of e.waypoints) grow(w.x, w.y);
  const bounds = Number.isFinite(minX)
    ? { x: round(minX), y: round(minY), width: round(maxX - minX), height: round(maxY - minY) }
    : emptyBounds();

  return {
    planeIndex,
    planes,
    bounds,
    processes,
    participants,
    lanes,
    nodes,
    edges,
    stats: {
      processes: processes.length, participants: participants.length, lanes: lanes.length,
      nodes: nodes.length, edges: edges.length,
      nodesWithoutShape: nodes.filter((n) => !n.hasShape).length,
    },
    warnings,
  };
}

function hashOf(xml) {
  return crypto.createHash('sha1').update(xml).digest('hex');
}

module.exports = { parseBpmn, hashOf };
