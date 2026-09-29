// Client HTTP per il BPMN server.
// Il diagramma viene scaricato in un buffer in memoria (DownloadHandlerBuffer) e deserializzato
// direttamente in oggetti C#: nessun file viene scritto su disco del visore.
using System;
using System.Collections;
using UnityEngine;
using UnityEngine.Networking;

namespace Eka.Bpmn
{
    public class BpmnApiClient : MonoBehaviour
    {
        [Header("Server")]
        [Tooltip("Es. http://192.168.1.50:3000 (senza / finale)")]
        public string baseUrl = "http://192.168.1.50:3000";
        [Tooltip("Lasciare vuoto se il server non ha API_KEY")]
        public string apiKey = "";
        public int timeoutSeconds = 10;

        [Header("Diagramma")]
        public string diagramId = "esempio";
        public int planeIndex = 0;
        public bool loadOnStart = true;
        [Tooltip("0 = nessun polling. Con ETag il server risponde 304 se nulla è cambiato.")]
        public float pollIntervalSeconds = 0f;

        /// <summary>Ultimo diagramma caricato (solo in RAM).</summary>
        public BpmnDiagram Current { get; private set; }

        public event Action<BpmnDiagram> DiagramLoaded;
        public event Action<string> LoadFailed;

        string _etag;

        void Start()
        {
            if (loadOnStart) Load();
            if (pollIntervalSeconds > 0f) StartCoroutine(PollLoop());
        }

        public void Load() => StartCoroutine(FetchDiagram(diagramId, planeIndex, null, null));

        IEnumerator PollLoop()
        {
            var wait = new WaitForSecondsRealtime(pollIntervalSeconds);
            while (true) { yield return wait; yield return FetchDiagram(diagramId, planeIndex, null, null); }
        }

        public IEnumerator FetchDiagram(string id, int plane, Action<BpmnDiagram> onOk, Action<string> onError)
        {
            string url = $"{baseUrl}/api/diagrams/{UnityWebRequest.EscapeURL(id)}?plane={plane}";
            using (var req = UnityWebRequest.Get(url))
            {
                req.downloadHandler = new DownloadHandlerBuffer(); // in memoria
                req.timeout = timeoutSeconds;
                if (!string.IsNullOrEmpty(apiKey)) req.SetRequestHeader("X-Api-Key", apiKey);
                bool sameDiagram = Current != null && Current.id == id && Current.planeIndex == plane;
                if (sameDiagram && !string.IsNullOrEmpty(_etag)) req.SetRequestHeader("If-None-Match", _etag);

                yield return req.SendWebRequest();

                if (req.responseCode == 304) { onOk?.Invoke(Current); yield break; } // invariato

                if (req.result != UnityWebRequest.Result.Success)
                {
                    string err = $"[BPMN] {req.responseCode} {req.error} {req.downloadHandler?.text}";
                    Debug.LogWarning(err);
                    onError?.Invoke(err); LoadFailed?.Invoke(err);
                    yield break;
                }

                BpmnDiagram diagram;
                try { diagram = JsonUtility.FromJson<BpmnDiagram>(req.downloadHandler.text); }
                catch (Exception ex)
                {
                    string err = "[BPMN] JSON non valido: " + ex.Message;
                    onError?.Invoke(err); LoadFailed?.Invoke(err);
                    yield break;
                }

                _etag = req.GetResponseHeader("ETag");
                Current = diagram;
                Debug.Log($"[BPMN] Caricato '{diagram.id}': {diagram.stats.nodes} nodi, {diagram.stats.edges} archi");
                onOk?.Invoke(diagram);
                DiagramLoaded?.Invoke(diagram);
            }
        }

        public IEnumerator FetchList(Action<BpmnDiagramSummary[]> onOk, Action<string> onError = null)
        {
            using (var req = UnityWebRequest.Get($"{baseUrl}/api/diagrams"))
            {
                req.timeout = timeoutSeconds;
                if (!string.IsNullOrEmpty(apiKey)) req.SetRequestHeader("X-Api-Key", apiKey);
                yield return req.SendWebRequest();
                if (req.result != UnityWebRequest.Result.Success) { onError?.Invoke(req.error); yield break; }
                onOk?.Invoke(JsonUtility.FromJson<BpmnDiagramList>(req.downloadHandler.text).diagrams);
            }
        }

        /// <summary>Libera il diagramma dalla memoria.</summary>
        public void Unload() { Current = null; _etag = null; }
    }
}
