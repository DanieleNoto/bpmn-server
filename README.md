# Grafico live per Unity / Meta Quest 3

Server Node.js che riceve valori numerici da una pagina web e li invia **in tempo reale** al visore via WebSocket, dove vengono disegnati su un grafico nel tempo.
I punti restano solo in RAM (ultimi 200).

```
 [Pagina /live]  ──POST──►  [Node server: ultimi 200 punti in RAM]  ──WebSocket──►  [Quest 3: grafico]
```

## Avvio

```bash
npm install
npm start                # porta 3000, ascolta su tutte le interfacce
# oppure con variabili da file:
cp .env.example .env && npm run start:env
npm test                 # test di invio, push, reset e autenticazione
```

All'avvio il server stampa gli indirizzi da usare, es. `http://192.168.1.50:3000/live` (pagina di invio) e `ws://192.168.1.50:3000/api/measurements/live` (dal Quest).

Docker: `docker build -t grafico-live . && docker run -p 3000:3000 grafico-live`

## Configurazione (variabili d'ambiente)

| Variabile | Default | Descrizione |
|---|---|---|
| `HOST` | `0.0.0.0` | Interfaccia di ascolto |
| `PORT` | `3000` | Porta |
| `API_KEY` | *(vuota)* | Se impostata, richiesta nell'header `X-Api-Key` (tutte le API tranne `/api/health`, WebSocket compreso) |
| `CORS_ORIGIN` | `*` | Header CORS |

## Pagina `/live`

Inserisci un valore e premi **Invia punto**: ogni invio aggiunge un punto al grafico.
**Reset grafico** cancella tutti i punti (chiede conferma).

## API

| Metodo | Endpoint | Descrizione |
|---|---|---|
| GET | `/live` | Pagina di invio valori (anche `/` reindirizza qui) |
| GET | `/api/health` | Stato del server |
| POST | `/api/measurements` | Aggiunge un punto. Body JSON `{ "value": 23.7 }` (numero finito tra -1e9 e 1e9) |
| DELETE | `/api/measurements` | Reset: svuota i punti e apre una nuova sessione |
| WS | `/api/measurements/live` | Stream dei punti verso il visore |

```bash
curl -X POST -H "Content-Type: application/json" -d '{"value":23.7}' http://localhost:3000/api/measurements
curl -X DELETE http://localhost:3000/api/measurements
```

### Messaggi WebSocket

Ogni messaggio ha la forma:

```jsonc
{ "session": "b1c2…", "points": [{ "id": 1, "value": 23.7, "time": 1792148885078 }] }
```

- Alla connessione arriva lo storico (fino a 200 punti), poi un messaggio per ogni nuovo punto.
- Al **reset** arriva `{ "session": "<nuova>", "points": [], "reset": true }`: il client deve svuotare il grafico.
  In generale, se `session` cambia rispetto all'ultima ricevuta, il client deve ripartire da zero (vale anche se il server è stato riavviato).
- `id` riparte da 1 dopo ogni reset.

### Impostazioni Android / Quest 3
- **Player Settings → Other → Internet Access = Require**.
- Se il server è in HTTP/WS (non HTTPS/WSS): **Player Settings → Other → Allow downloads over HTTP = Always allowed**.
- Quest e server devono essere sulla stessa rete (LAN) o il server deve essere raggiungibile pubblicamente; su Windows apri la porta 3000 nel firewall.
- Per un server esterno/cloud: mettilo dietro HTTPS (reverse proxy, es. Caddy/Nginx) e imposta `API_KEY`.
