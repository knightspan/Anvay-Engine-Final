# backend/main.py
import os
import json
import asyncio
import base64
from fastapi import FastAPI, WebSocket, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
from neo4j import GraphDatabase
from dotenv import load_dotenv
from sarvam_client import SarvamClient
from rag.orchestrator import run_query

load_dotenv()

URI = os.getenv("NEO4J_URI",      "neo4j://127.0.0.1:7687")
USER = os.getenv("NEO4J_USER",     "neo4j")
PASS = os.getenv("NEO4J_PASSWORD", "anvay2025")
DB = "anvay"

app = FastAPI(title="ANVAY Intelligence API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"]
)

driver = GraphDatabase.driver(URI, auth=(USER, PASS))
sarvam = SarvamClient()

# ── PYDANTIC MODELS ───────────────────────────────────────────────


class QueryPayload(BaseModel):
    query: str


class SpeakPayload(BaseModel):
    text: str
    language: str = "en-IN"


class JarvisPayload(BaseModel):
    query: str
    language: str = "en-IN"

# ── HEALTH ────────────────────────────────────────────────────────


@app.get("/")
def health():
    return {"status": "ANVAY API running", "database": DB, "version": "1.0.0"}

# ── GRAPH: FULL ───────────────────────────────────────────────────


@app.get("/api/graph/full")
def get_full_graph():
    with driver.session(database=DB) as s:
        n_res = s.run("""
            MATCH (n) WHERE NOT n:StateSnapshot
            RETURN id(n)          AS id,
                   labels(n)[0]   AS label,
                   coalesce(n.name, n.title, n.id) AS name,
                   n.domain       AS domain,
                   n.severity     AS severity,
                   n.country      AS country,
                   n.summary      AS summary
            LIMIT 120
        """)
        e_res = s.run("""
            MATCH (a)-[r]->(b)
            WHERE NOT a:StateSnapshot AND NOT b:StateSnapshot
            RETURN id(a)            AS source,
                   id(b)            AS target,
                   type(r)          AS type,
                   r.confidence     AS confidence,
                   r.domain_bridge  AS domain_bridge,
                   r.lag_days       AS lag_days
            LIMIT 300
        """)
        nodes = [dict(n) for n in n_res]
        links = [dict(e) for e in e_res]
    return {
        "nodes":      nodes,
        "links":      links,
        "node_count": len(nodes),
        "link_count": len(links)
    }

# ── GRAPH: ENTITY DRILL-DOWN ──────────────────────────────────────


@app.get("/api/graph/entity/{name}")
def get_entity_subgraph(name: str, hops: int = 3):
    hops = min(hops, 4)
    with driver.session(database=DB) as s:
        n_res = s.run(f"""
            MATCH path = (start)-[*1..{hops}]-(end)
            WHERE (start.name=$name OR start.title=$name OR start.id=$name)
              AND NOT end:StateSnapshot
            WITH nodes(path) AS nds
            UNWIND nds AS n
            WITH DISTINCT n
            RETURN id(n)         AS id,
                   labels(n)[0]  AS label,
                   coalesce(n.name,n.title,n.id) AS name,
                   n.domain      AS domain,
                   n.severity    AS severity
            LIMIT 60
        """, name=name)
        nodes = [dict(r) for r in n_res]
        ids = [n["id"] for n in nodes]

        e_res = s.run("""
            MATCH (a)-[r]->(b)
            WHERE id(a) IN $ids AND id(b) IN $ids
              AND NOT a:StateSnapshot AND NOT b:StateSnapshot
            RETURN id(a)        AS source,
                   id(b)        AS target,
                   type(r)      AS type,
                   r.confidence AS confidence
        """, ids=ids)
        links = [dict(r) for r in e_res]
    return {"nodes": nodes, "links": links, "center": name}

# ── STATS ─────────────────────────────────────────────────────────


@app.get("/api/stats")
def get_stats():
    with driver.session(database=DB) as s:
        cnt = s.run("""
            MATCH (n) WHERE NOT n:StateSnapshot
            RETURN labels(n)[0] AS label, count(n) AS cnt
        """)
        rel_cnt = s.run("""
            MATCH ()-[r]->()
            WHERE NOT startNode(r):StateSnapshot
            RETURN count(r) AS cnt
        """).single()["cnt"]

        stats = {r["label"]: r["cnt"] for r in cnt if r["label"]}
        stats["relationships"] = rel_cnt
        stats["total_nodes"] = sum(
            v for k, v in stats.items() if k != "relationships"
        )
    return stats

# ── ALERTS ────────────────────────────────────────────────────────


@app.get("/api/alerts")
def get_alerts():
    with driver.session(database=DB) as s:
        res = s.run("""
            MATCH (e:Event) WHERE e.severity >= 0.65
            RETURN e.title        AS title,
                   e.severity     AS severity,
                   e.domain       AS domain,
                   e.published_at AS date,
                   e.summary      AS summary
            ORDER BY e.severity DESC
            LIMIT 8
        """)
        alerts = [
            {
                **dict(r),
                "alert_type": (
                    "CRITICAL" if r["severity"] >= 0.80 else
                    "HIGH" if r["severity"] >= 0.70 else
                    "ELEVATED"
                )
            }
            for r in res
        ]
    return {"alerts": alerts, "count": len(alerts)}

# ── TEMPORAL ──────────────────────────────────────────────────────


@app.get("/api/temporal/{entity}")
def get_temporal(entity: str):
    with driver.session(database=DB) as s:
        res = s.run("""
MATCH (n)-[:HAS_SNAPSHOT]->(snap:StateSnapshot)
WHERE n.id = $entity OR n.name = $entity            RETURN snap.snapshot_time AS t,
                   snap.state         AS state,
                   snap.month         AS month
            ORDER BY snap.snapshot_time
        """, entity=entity)
        snapshots = []
        for r in res:
            try:
                state = json.loads(r["state"])
            except Exception:
                state = {}
            snapshots.append({
                "time":             str(r["t"]),
                "month":            r["month"],
                "state":            state,
                "severity":         state.get("severity", 0),
                "violations":       state.get("violations"),
                "rainfall_deficit": state.get("rainfall_deficit")
            })
    return {"entity": entity, "trajectory": snapshots, "points": len(snapshots)}

# ── KILLER DEMO CHAIN ─────────────────────────────────────────────


@app.get("/api/chain-demo")
def get_chain_demo():
    with driver.session(database=DB) as s:
        res = s.run("""
            MATCH path =
              (ph:Phenomenon {id:'PHE001'})
              -[:TRIGGERS]->
              (e1:Event {id:'EVT003'})
              -[:CAUSES]->
              (e2:Event {id:'EVT004'})
              -[:ESCALATES_TO]->
              (e3:Event {id:'EVT007'})
              -[:CORRELATES_WITH]->
              (e4:Event {id:'EVT002'})
            RETURN
              [n IN nodes(path) | {
                name:     coalesce(n.name, n.title, n.id),
                label:    labels(n)[0],
                domain:   n.domain,
                severity: n.severity,
                summary:  n.summary
              }] AS chain,
              [r IN relationships(path) | {
                type:          type(r),
                confidence:    r.confidence,
                lag_days:      r.lag_days,
                domain_bridge: r.domain_bridge
              }] AS edges
        """)
        rows = [dict(r) for r in res]

    if rows:
        return {
            "chain":       rows[0]["chain"],
            "edges":       rows[0]["edges"],
            "depth":       len(rows[0]["chain"]) - 1,
            "description": "Drought -> Food Price -> Civil Unrest -> LoC Tension"
        }
    return {"error": "Chain not found — make sure seed_graph.py ran successfully"}

# ── INTELLIGENCE QUERY ────────────────────────────────────────────


@app.post("/api/query")
async def intelligence_query(payload: QueryPayload):
    if not payload.query.strip():
        raise HTTPException(400, "Query cannot be empty")
    result = run_query(payload.query)
    return result

# ── JARVIS VOICE ──────────────────────────────────────────────────


@app.post("/api/jarvis/transcribe")
async def transcribe(audio: UploadFile = File(...), language: str = "hi-IN"):
    audio_bytes = await audio.read()
    transcript = sarvam.transcribe(audio_bytes, language)
    return {"transcript": transcript, "language": language}


@app.post("/api/jarvis/speak")
async def speak(payload: SpeakPayload):
    audio_bytes = sarvam.synthesize(payload.text, payload.language)
    if not audio_bytes:
        raise HTTPException(
            503, "TTS unavailable — add SARVAM_API_KEY to .env")
    return Response(content=audio_bytes, media_type="audio/wav")


@app.post("/api/jarvis/full")
async def jarvis_full(payload: JarvisPayload):
    result = run_query(payload.query)
    response_txt = result.get("response", "")[:500]
    audio_bytes = sarvam.synthesize(response_txt, payload.language)
    return {
        **result,
        "audio_b64": base64.b64encode(audio_bytes).decode() if audio_bytes else None,
        "language":  payload.language
    }

# ── LIVE WEBSOCKET ────────────────────────────────────────────────


@app.websocket("/ws/live")
async def live_feed(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            with driver.session(database=DB) as s:
                events = s.run("""
                    MATCH (e:Event)
                    RETURN e.title    AS title,
                           e.domain   AS domain,
                           e.severity AS severity,
                           e.updated  AS updated
                    ORDER BY e.updated DESC
                    LIMIT 5
                """)
                data = [dict(r) for r in events]
            await ws.send_json({"type": "live_update", "events": data})
            await asyncio.sleep(8)
    except Exception:
        pass

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
