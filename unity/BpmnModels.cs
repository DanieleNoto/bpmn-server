// Modelli dati per il JSON restituito da GET /api/diagrams/{id}
// Compatibili con UnityEngine.JsonUtility (solo campi pubblici, array, nessun dizionario).
// Coordinate in pixel BPMN: origine in alto a sinistra, Y verso il basso.
using System;

namespace Eka.Bpmn
{
    [Serializable] public class BpmnBounds { public float x, y, width, height; }
    [Serializable] public class BpmnPoint { public float x, y; }

    [Serializable] public class BpmnProperty { public string key, value; }

    [Serializable]
    public class BpmnPlaneInfo { public int index; public string id, name, bpmnElement; }

    [Serializable]
    public class BpmnProcess { public string id, name; public bool isExecutable; }

    [Serializable]
    public class BpmnShapeBase
    {
        public string id, name;
        public float x, y, width, height;
        public bool hasShape, isExpanded, isHorizontal, hasLabel;
        public BpmnBounds label;
    }

    [Serializable] public class BpmnParticipant : BpmnShapeBase { public string processId; }
    [Serializable] public class BpmnLane : BpmnShapeBase { public string processId, parentLaneId; }

    [Serializable]
    public class BpmnNode : BpmnShapeBase
    {
        public string type;            // startEvent, userTask, exclusiveGateway, subProcess, ...
        public string category;        // event | task | subprocess | gateway | data | artifact
        public string eventDefinition; // none | message | timer | error | signal | ... | multiple
        public string documentation, text;
        public string processId, parentId, laneId, laneName, attachedToRef, calledElement;
        public bool cancelActivity, isInterrupting, triggeredByEvent;
        public bool isLoop, isMultiInstance, isSequential;
        public string[] incoming, outgoing;
        public string[] annotations;     // testi delle textAnnotation collegate
        public BpmnProperty[] properties; // estensioni: camunda topic, output/input parameter, listener, cost...

        public string GetProperty(string key)
        {
            if (properties != null) foreach (var p in properties) if (p.key == key) return p.value;
            return null;
        }
    }

    [Serializable]
    public class BpmnEdge
    {
        public string id, type;        // sequenceFlow | messageFlow | association | dataInputAssociation | dataOutputAssociation
        public string name, sourceId, targetId, condition, processId, parentId, direction;
        public bool isDefault, hasShape, hasLabel;
        public BpmnPoint[] waypoints;
        public BpmnBounds label;
    }

    [Serializable]
    public class BpmnStats { public int processes, participants, lanes, nodes, edges, nodesWithoutShape; }

    [Serializable]
    public class BpmnDiagram
    {
        public string id, fileName, hash, updatedAt;
        public int planeIndex;
        public BpmnPlaneInfo[] planes;
        public BpmnBounds bounds;
        public BpmnProcess[] processes;
        public BpmnParticipant[] participants;
        public BpmnLane[] lanes;
        public BpmnNode[] nodes;
        public BpmnEdge[] edges;
        public BpmnStats stats;
        public string[] warnings;
    }

    [Serializable]
    public class BpmnDiagramSummary
    {
        public string id, fileName, hash, updatedAt, name;
        public int planeCount;
        public BpmnStats stats;
    }

    [Serializable] public class BpmnDiagramList { public BpmnDiagramSummary[] diagrams; }
}
