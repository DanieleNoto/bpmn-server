// Scarica l'XML BPMN originale dal server (GET /api/diagrams/{id}/raw) e lo tiene solo in RAM.
// Collega l'evento OnXmlLoaded al tuo parser esistente, che deve accettare una string
// (es. XDocument.Parse(xml) / XmlDocument.LoadXml(xml) al posto del caricamento da file).
using System.Collections;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.Networking;

public class BpmnRemoteSource : MonoBehaviour
{
    [Tooltip("Es. http://192.168.1.50:3000 (senza / finale). In Editor puoi usare http://localhost:3000")]
    public string baseUrl = "http://192.168.1.50:3000";
    public string diagramId = "richiesta_ferie";
    [Tooltip("Lasciare vuoto se il server non ha API_KEY")]
    public string apiKey = "";
    public int timeoutSeconds = 10;
    public bool loadOnStart = true;

    [System.Serializable] public class XmlEvent : UnityEvent<string> { }
    [Tooltip("Riceve l'XML come stringa: collega qui il metodo del tuo parser")]
    public XmlEvent OnXmlLoaded;

    public string Xml { get; private set; }

    void Start() { if (loadOnStart) Load(); }

    public void Load() => StartCoroutine(Fetch());

    IEnumerator Fetch()
    {
        using (var req = UnityWebRequest.Get($"{baseUrl}/api/diagrams/{UnityWebRequest.EscapeURL(diagramId)}/raw"))
        {
            req.timeout = timeoutSeconds;
            if (!string.IsNullOrEmpty(apiKey)) req.SetRequestHeader("X-Api-Key", apiKey);
            yield return req.SendWebRequest();

            if (req.result != UnityWebRequest.Result.Success)
            {
                Debug.LogError($"[BPMN] {req.responseCode} {req.error}");
                yield break;
            }

            Xml = req.downloadHandler.text; // solo in memoria, nessun file su disco
            Debug.Log($"[BPMN] XML ricevuto ({Xml.Length} caratteri)");
            OnXmlLoaded?.Invoke(Xml);
        }
    }
}
