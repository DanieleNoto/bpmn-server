// Renderer di esempio: costruisce il grafo BPMN in 3D sotto questo GameObject a partire
// dal diagramma in RAM (nessun asset o file generato). Punto di partenza da personalizzare
// con prefab/materiali propri.
using System.Collections.Generic;
using TMPro;
using UnityEngine;

namespace Eka.Bpmn
{
    public class BpmnGraphRenderer : MonoBehaviour
    {
        public BpmnApiClient client;
        [Tooltip("Metri per pixel BPMN. 0.001 => 1000 px = 1 m")]
        public float metersPerPixel = 0.001f;
        public float depth = 0.01f;
        public float lineWidth = 0.002f;
        public float fontSize = 0.25f;
        public bool centerOnOrigin = true;
        [Tooltip("Opzionale: materiale base (consigliato in build, es. URP/Unlit). Se vuoto usa Shader.Find")]
        public Material baseMaterial;

        [Header("Colori")]
        public Color poolColor = new Color(0.95f, 0.95f, 0.95f);
        public Color laneColor = new Color(0.88f, 0.92f, 0.97f);
        public Color taskColor = new Color(1f, 1f, 0.8f);
        public Color startColor = new Color(0.6f, 0.9f, 0.6f);
        public Color endColor = new Color(0.95f, 0.55f, 0.55f);
        public Color eventColor = new Color(1f, 0.85f, 0.5f);
        public Color gatewayColor = new Color(1f, 0.9f, 0.4f);
        public Color dataColor = new Color(0.85f, 0.85f, 0.85f);
        public Color edgeColor = Color.black;
        public Color messageColor = new Color(0.2f, 0.4f, 0.9f);
        public Color textColor = Color.black;

        readonly Dictionary<Color, Material> _materials = new Dictionary<Color, Material>();
        readonly Dictionary<string, GameObject> _objects = new Dictionary<string, GameObject>();
        Transform _root;
        BpmnBounds _b;

        public GameObject GetObject(string bpmnId) => _objects.TryGetValue(bpmnId, out var go) ? go : null;

        void OnEnable() { if (client) client.DiagramLoaded += Render; }
        void OnDisable() { if (client) client.DiagramLoaded -= Render; }

        public void Clear()
        {
            if (_root) Destroy(_root.gameObject);
            _objects.Clear();
        }

        public void Render(BpmnDiagram d)
        {
            Clear();
            _b = d.bounds;
            _root = new GameObject($"BPMN_{d.id}").transform;
            _root.SetParent(transform, false);

            foreach (var p in d.participants) if (p.hasShape) Box(p, poolColor, 3f, p.name, true);
            foreach (var l in d.lanes) if (l.hasShape) Box(l, laneColor, 2f, l.name, true);

            foreach (var n in d.nodes)
            {
                if (!n.hasShape) continue;
                float layer = n.type == "boundaryEvent" ? -1f : 0f;
                switch (n.category)
                {
                    case "event":
                        var c = n.type == "startEvent" ? startColor : n.type == "endEvent" ? endColor : eventColor;
                        Disc(n, c, layer);
                        break;
                    case "gateway": Diamond(n, gatewayColor); break;
                    case "data":
                    case "artifact": Box(n, dataColor, 0.5f, n.category == "artifact" ? n.text : n.name, false); break;
                    default: Box(n, taskColor, 0f, n.name, false); break; // task / subprocess
                }
            }

            foreach (var e in d.edges)
            {
                if (!e.hasShape || e.waypoints == null || e.waypoints.Length < 2) continue;
                Line(e, e.type == "messageFlow" ? messageColor : edgeColor);
            }
        }

        // ---- conversione coordinate BPMN (Y giù) -> locali Unity (Y su) ----
        Vector3 ToLocal(float x, float y, float layer = 0f)
        {
            float ox = centerOnOrigin ? _b.x + _b.width / 2f : _b.x;
            float oy = centerOnOrigin ? _b.y + _b.height / 2f : _b.y;
            return new Vector3((x - ox) * metersPerPixel, -(y - oy) * metersPerPixel, layer * depth);
        }
        Vector3 Center(BpmnShapeBase s, float layer) => ToLocal(s.x + s.width / 2f, s.y + s.height / 2f, layer);
        Vector3 Size(BpmnShapeBase s, float zMul = 1f) => new Vector3(s.width * metersPerPixel, s.height * metersPerPixel, depth * zMul);

        GameObject Make(PrimitiveType type, string id, Color color)
        {
            var go = GameObject.CreatePrimitive(type);
            go.name = id;
            go.transform.SetParent(_root, false);
            go.GetComponent<Renderer>().sharedMaterial = Mat(color);
            _objects[id] = go;
            return go;
        }

        void Box(BpmnShapeBase s, Color color, float layer, string text, bool container)
        {
            var go = Make(PrimitiveType.Cube, s.id, color);
            go.transform.localPosition = Center(s, layer);
            go.transform.localScale = Size(s, container ? 0.2f : 1f);
            if (container)
            {
                // nome del pool/lane nella fascia a sinistra, ruotato
                var pos = s.isHorizontal ? ToLocal(s.x + 15f, s.y + s.height / 2f, layer - 0.6f) : ToLocal(s.x + s.width / 2f, s.y + 15f, layer - 0.6f);
                Label(s.id, text, pos, s.isHorizontal ? 90f : 0f, new Vector2(s.height, 30f));
            }
            else Label(s.id, text, Center(s, layer - 0.6f), 0f, new Vector2(s.width, s.height));
        }

        void Disc(BpmnNode n, Color color, float layer)
        {
            var go = Make(PrimitiveType.Cylinder, n.id, color);
            go.transform.localPosition = Center(n, layer);
            go.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);
            go.transform.localScale = new Vector3(n.width * metersPerPixel, depth * 0.5f, n.height * metersPerPixel);
            ExternalLabel(n);
        }

        void Diamond(BpmnNode n, Color color)
        {
            var go = Make(PrimitiveType.Cube, n.id, color);
            go.transform.localPosition = Center(n, 0f);
            go.transform.localRotation = Quaternion.Euler(0f, 0f, 45f);
            float side = n.width * metersPerPixel / Mathf.Sqrt(2f);
            go.transform.localScale = new Vector3(side, side, depth);
            ExternalLabel(n);
        }

        void ExternalLabel(BpmnNode n)
        {
            if (string.IsNullOrEmpty(n.name)) return;
            var lb = n.hasLabel ? n.label : new BpmnBounds { x = n.x - 20, y = n.y + n.height + 4, width = n.width + 40, height = 20 };
            Label(n.id, n.name, ToLocal(lb.x + lb.width / 2f, lb.y + lb.height / 2f, -0.6f), 0f, new Vector2(Mathf.Max(lb.width, 60f), lb.height));
        }

        void Line(BpmnEdge e, Color color)
        {
            var go = new GameObject(e.id);
            go.transform.SetParent(_root, false);
            var lr = go.AddComponent<LineRenderer>();
            lr.useWorldSpace = false;
            lr.sharedMaterial = Mat(color);
            lr.startWidth = lr.endWidth = lineWidth;
            lr.positionCount = e.waypoints.Length;
            for (int i = 0; i < e.waypoints.Length; i++) lr.SetPosition(i, ToLocal(e.waypoints[i].x, e.waypoints[i].y, -0.8f));
            _objects[e.id] = go;

            if (!string.IsNullOrEmpty(e.name) && e.hasLabel)
                Label(e.id, e.name, ToLocal(e.label.x + e.label.width / 2f, e.label.y + e.label.height / 2f, -0.8f), 0f, new Vector2(Mathf.Max(e.label.width, 40f), e.label.height));
        }

        void Label(string id, string text, Vector3 localPos, float rotZ, Vector2 sizePx)
        {
            if (string.IsNullOrEmpty(text)) return;
            var go = new GameObject(id + "_label");
            go.transform.SetParent(_root, false);
            go.transform.localPosition = localPos;
            go.transform.localRotation = Quaternion.Euler(0f, 0f, rotZ);
            var tmp = go.AddComponent<TextMeshPro>();
            tmp.text = text;
            tmp.fontSize = fontSize;
            tmp.color = textColor;
            tmp.alignment = TextAlignmentOptions.Center;
            tmp.enableWordWrapping = true;
            tmp.rectTransform.sizeDelta = sizePx * metersPerPixel;
        }

        Material Mat(Color c)
        {
            if (_materials.TryGetValue(c, out var m)) return m;
            if (baseMaterial) m = new Material(baseMaterial);
            else
            {
                var shader = Shader.Find("Universal Render Pipeline/Unlit");
                if (!shader) shader = Shader.Find("Unlit/Color");
                if (!shader) shader = Shader.Find("Sprites/Default");
                m = new Material(shader);
            }
            m.color = c;
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", c);
            _materials[c] = m;
            return m;
        }

        void OnDestroy()
        {
            Clear();
            foreach (var m in _materials.Values) Destroy(m);
        }
    }
}
