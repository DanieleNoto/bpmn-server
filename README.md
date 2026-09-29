# BPMN Server per Unity / Meta Quest 3

Server Node.js che legge file `.bpmn` (BPMN 2.0), li parsa **una volta sul server** e li espone via API come JSON "render-ready" (nodi, archi, pool, lane con coordinate).
L'app Unity sul Quest scarica il JSON in un buffer in memoria e costruisce il grafo: **nessun file viene salvato sul visore**.

```
 .bpmn  ──►  [Node server: parse + cache RAM]  ──HTTP/JSON──►  [Quest 3: UnityWebRequest → RAM → rendering]
```

## Avvio

```bash
npm install
npm start                # porta 3000, ascolta su tutte le interfacce
# oppure con variabili da file:
cp .env.example .env && npm run start:env
```

All'avvio il server stampa gli IP da usare dal visore, es. `http://192.168.1.50:3000/api/diagrams`.

Metti i file `.bpmn` nella cartella `bpmn/`: vengono caricati all'avvio e **ricaricati automaticamente** quando li modifichi o sostituisci. L'id del diagramma è il nome del file senza estensione (`processo.bpmn` → `processo`).

Docker: `docker build -t bpmn-server . && docker run -p 3000:3000 -v $PWD/bpmn:/app/bpmn bpmn-server`

## Configurazione (variabili d'ambiente)

| Variabile | Default | Descrizione |
|---|---|---|
| `HOST` | `0.0.0.0` | Interfaccia di ascolto |
| `PORT` | `3000` | Porta |
| `BPMN_DIR` | `./bpmn` | Cartella dei file BPMN |
| `API_KEY` | *(vuota)* | Se impostata, richiesta nell'header `X-Api-Key` (tutte le API tranne `/api/health`) |
| `PERSIST_UPLOADS` | `true` | Se `false`, i diagrammi caricati via PUT restano solo in RAM |
| `MAX_UPLOAD_SIZE` | `20mb` | Dimensione massima upload |
| `CORS_ORIGIN` | `*` | Header CORS |

## API

| Metodo | Endpoint | Descrizione |
|---|---|---|
| GET | `/api/health` | Stato del server |
| GET | `/api/diagrams` | Elenco diagrammi (id, nome, hash, statistiche) |
| GET | `/api/diagrams/{id}` | **JSON parsato** del diagramma. `?plane=N` per i piani secondari (es. contenuto di un sottoprocesso collassato) |
| GET | `/api/diagrams/{id}/meta` | Solo hash, bounds, piani, statistiche (per controllare aggiornamenti) |
| GET | `/api/diagrams/{id}/raw` | XML originale |
| PUT/POST | `/api/diagrams/{id}` | Carica/sostituisce un BPMN (body = XML) |
| DELETE | `/api/diagrams/{id}` | Rimuove il diagramma |

Il GET del diagramma restituisce un `ETag`: se Unity rimanda `If-None-Match`, il server risponde `304` senza body quando nulla è cambiato (polling leggero).

Caricare un file:
```bash
curl -X PUT -H "Content-Type: application/xml" --data-binary @mio.bpmn http://localhost:3000/api/diagrams/mio
```

### Formato JSON (estratto)

```jsonc
{
  "id": "esempio", "hash": "8af0…", "planeIndex": 0,
  "bounds": { "x": 100, "y": 20, "width": 900, "height": 530 },   // bounding box totale in px
  "planes": [{ "index": 0, "id": "Diagram_1", "bpmnElement": "Collab_1" }],
  "participants": [{ "id": "Pool_Azienda", "name": "Azienda", "x": 100, "y": 150, "width": 900, "height": 400, "hasShape": true, … }],
  "lanes": [{ "id": "Lane_Vendite", "name": "Vendite", "parentLaneId": "", … }],
  "nodes": [{
    "id": "Start_1", "type": "startEvent", "category": "event", "eventDefinition": "message",
    "name": "Ordine ricevuto", "laneId": "Lane_Vendite", "parentId": "", "attachedToRef": "",
    "x": 182, "y": 232, "width": 36, "height": 36, "hasShape": true,
    "hasLabel": true, "label": { "x": 160, "y": 275, "width": 80, "height": 14 },
    "incoming": [], "outgoing": ["Flow_1"], …
  }],
  "edges": [{
    "id": "Flow_Si", "type": "sequenceFlow", "name": "Sì", "sourceId": "Gw_1", "targetId": "Sub_Spedizione",
    "condition": "${disponibile}", "isDefault": false,
    "waypoints": [{ "x": 450, "y": 275 }, { "x": 450, "y": 410 }], …
  }],
  "stats": { … }, "warnings": []
}
```

- `nodes[].laneName`: nome della lane (es. `DIPENDENTE`), `nodes[].annotations`: testi delle annotazioni collegate.
- `nodes[].properties`: estensioni non standard appiattite in `{key, value}`, es. Camunda
  `topic` = `NotificaHandler`, `inputOutput.outputParameter[accepted]` = `${accepted}`,
  `taskListener[create].script`, oppure custom come `cost` = `0`. In C#: `node.GetProperty("topic")`.
- `category`: `event` | `task` | `subprocess` | `gateway` | `data` | `artifact`
- `edges[].type`: `sequenceFlow` | `messageFlow` | `association` | `dataInputAssociation` | `dataOutputAssociation`
- Coordinate BPMN: origine in alto a sinistra, **Y verso il basso** (in Unity va invertita, lo fa già il renderer d'esempio).
- Nessun `null` e solo array: il JSON si deserializza direttamente con `JsonUtility`.
- `hasShape: false` = elemento senza grafica nel piano richiesto (es. nodi dentro un sottoprocesso collassato → usa `?plane=1`).

## Lato Unity (cartella `unity/`)

Copia i 3 script in `Assets/Scripts/Bpmn/`:

- **`BpmnModels.cs`** – classi dati per `JsonUtility`.
- **`BpmnApiClient.cs`** – scarica il diagramma con `UnityWebRequest` + `DownloadHandlerBuffer` (solo RAM), gestisce ETag/304, polling opzionale, API key.
- **`BpmnGraphRenderer.cs`** – esempio di rendering 3D con primitive, `LineRenderer` e TextMeshPro. Da sostituire/personalizzare con i vostri prefab.

Setup scena:
1. GameObject vuoto → aggiungi `BpmnApiClient` (imposta `baseUrl` con l'IP del server e `diagramId`).
2. Stesso o altro GameObject → aggiungi `BpmnGraphRenderer` e trascina il client nel campo `client`. Posizionalo davanti alla camera (es. z = 1.5 m).
3. Opzionale: assegna `baseMaterial` (es. un materiale URP/Unlit) così lo shader è sicuramente incluso nella build.

Uso da codice:
```csharp
StartCoroutine(client.FetchDiagram("esempio", 0,
    d => renderer.Render(d),
    err => Debug.LogError(err)));
```

### Impostazioni Android / Quest 3
- **Player Settings → Other → Internet Access = Require**.
- Se il server è in HTTP (non HTTPS): **Player Settings → Other → Allow downloads over HTTP = Always allowed** (altrimenti Android blocca il traffico in chiaro).
- Quest e server devono essere sulla stessa rete (LAN) o il server deve essere raggiungibile pubblicamente; su Windows apri la porta 3000 nel firewall.
- Per un server esterno/cloud: mettilo dietro HTTPS (reverse proxy, es. Caddy/Nginx) e imposta `API_KEY`.
