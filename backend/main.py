# backend/main.py
import os, json, asyncio, base64, requests, time
from fastapi import FastAPI, WebSocket, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
from neo4j import GraphDatabase
from dotenv import load_dotenv, find_dotenv
from sarvam_client import SarvamClient
from rag.orchestrator import run_query

load_dotenv(find_dotenv(), override=True)

URI = os.getenv("NEO4J_URI",      "neo4j://127.0.0.1:7687")


USER = os.getenv("NEO4J_USER",     "neo4j")
PASS = os.getenv("NEO4J_PASSWORD", "anvay2025")
DB = "neo4j"

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

# ── ACLED PROXY ───────────────────────────────────────────────────

ACLED_TOKEN = None
ACLED_TOKEN_EXPIRY = 0

def get_acled_token():
    global ACLED_TOKEN, ACLED_TOKEN_EXPIRY
    email = os.getenv("ACLED_EMAIL")
    password = os.getenv("ACLED_PASSWORD")
    if not email or not password:
        return None
    
    # Simple caching for token (ACLED tokens usually last 1 hour)
    if ACLED_TOKEN and time.time() < ACLED_TOKEN_EXPIRY:
        return ACLED_TOKEN

    try:
        r = requests.post("https://acleddata.com/oauth/token", 
            data={
                "username": email,
                "password": password,
                "grant_type": "password",
                "client_id": "acled"
            }, timeout=10)
        r.raise_for_status()
        data = r.json()
        ACLED_TOKEN = data.get("access_token")
        ACLED_TOKEN_EXPIRY = time.time() + 3500 # 1 hour approx
        return ACLED_TOKEN
    except Exception as e:
        print(f"ACLED Token Error: {e}")
        return None

@app.get("/api/acled")
async def get_acled_data():
    token = get_acled_token()
    if not token:
        # Fallback to demo data if ACLED authentication fails or is blocked
        print("ACLED Auth failed. Using Demo Data.")
        return [
            {"lat": 33.7, "lng": 76.3, "name": "LAC Tension Zone — Eastern Ladakh", "domain": "defence", "sev": 0.82, "detail": "PLA exercise + India LAC standoff 2026"},
            {"lat": 24.8, "lng": 62.0, "name": "CPEC Phase III — Gwadar", "domain": "geopolitics", "sev": 0.75, "detail": "$15 billion infrastructure investment"},
            {"lat": 28.6, "lng": 77.2, "name": "Food Price Protests — Delhi", "domain": "society", "sev": 0.61, "detail": "Civil unrest over wheat inflation"},
            {"lat": 32.5, "lng": 74.5, "name": "LoC Ceasefire Violations", "domain": "defence", "sev": 0.82, "detail": "17 incidents in Feb 2026"},
            {"lat": 30.7, "lng": 79.0, "name": "Depsang LAC Standoff", "domain": "defence", "sev": 0.77, "detail": "India-China military face-off"},
            {"lat": 18.5, "lng": 73.8, "name": "Maharashtra Food Protests", "domain": "society", "sev": 0.71, "detail": "6 border districts — police deployed"}
        ]

    params = {
        "country": "India:OR:country=Pakistan:OR:country=China",
        "year": "2026",
        "limit": "400",
        "_format": "json"
    }
    
    try:
        r = requests.get("https://acleddata.com/api/acled/read", 
            params=params, 
            headers={"Authorization": f"Bearer {token}"},
            timeout=15)
        r.raise_for_status()
        data = r.json().get("data", [])
        
        EVENT_DOMAIN_MAP = {
            "Battles": "defence",
            "Violence against civilians": "society",
            "Explosions/Remote violence": "defence",
            "Protests": "society",
            "Riots": "society",
            "Strategic developments": "geopolitics"
        }
        
        mapped = []
        for row in data:
            try:
                fatalities = int(row.get("fatalities", 0))
                severity = min(1.0, fatalities / 50.0)
                mapped.append({
                    "lat": float(row.get("latitude")),
                    "lng": float(row.get("longitude")),
                    "name": row.get("location"),
                    "domain": EVENT_DOMAIN_MAP.get(row.get("event_type"), "default"),
                    "sev": severity,
                    "detail": (row.get("notes") or row.get("event_type"))[:120]
                })
            except: continue
            
        return mapped
    except Exception as e:
        # Fallback to demo data on API error as well
        print(f"ACLED API error: {e}. Using Demo Data.")
        return [
            {"lat": 33.7, "lng": 76.3, "name": "LAC Tension Zone — Eastern Ladakh", "domain": "defence", "sev": 0.82, "detail": "PLA exercise + India LAC standoff 2026"},
            {"lat": 24.8, "lng": 62.0, "name": "CPEC Phase III — Gwadar", "domain": "geopolitics", "sev": 0.75, "detail": "$15 billion infrastructure investment"},
            {"lat": 28.6, "lng": 77.2, "name": "Food Price Protests — Delhi", "domain": "society", "sev": 0.61, "detail": "Civil unrest over wheat inflation"},
            {"lat": 32.5, "lng": 74.5, "name": "LoC Ceasefire Violations", "domain": "defence", "sev": 0.82, "detail": "17 incidents in Feb 2026"}
        ]

# ── FIRMS PROXY ───────────────────────────────────────────────────

@app.get("/api/firms")
async def get_firms_data():
    firms_key = os.getenv("VITE_FIRMS_MAP_KEY")
    if not firms_key:
        raise HTTPException(500, "FIRMS Map Key not configured in backend .env")
        
    url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{firms_key}/VIIRS_SNPP_NRT/world/1"
    try:
        r = requests.get(url, timeout=15)
        r.raise_for_status()
        # Return the CSV text exactly as received
        return Response(content=r.text, media_type="text/csv")
    except Exception as e:
        print(f"FIRMS API Error: {e}")
        # Return empty CSV string with headers
        return Response(content="latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight", media_type="text/csv")


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
