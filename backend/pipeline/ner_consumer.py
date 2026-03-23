# backend/pipeline/ner_consumer.py
import json, re, time
import spacy
from kafka import KafkaConsumer
from neo4j import GraphDatabase
from dotenv import load_dotenv
import os

load_dotenv()

nlp = spacy.load("en_core_web_sm")

URI  = os.getenv("NEO4J_URI",      "neo4j://127.0.0.1:7687")
USER = os.getenv("NEO4J_USER",     "neo4j")
PASS = os.getenv("NEO4J_PASSWORD", "anvay2025")
DB   = "neo4j"

driver = GraphDatabase.driver(URI, auth=(USER, PASS))

TOPICS = [
    "anvay-geopolitics","anvay-defence","anvay-economics",
    "anvay-climate","anvay-society","anvay-parliamentary"
]

NATION_MAP = {
    "India":    ["india","indian","bharat","new delhi"],
    "China":    ["china","chinese","beijing","prc"],
    "Pakistan": ["pakistan","pakistani","islamabad","rawalpindi"],
    "USA":      ["usa","united states","american","washington","us "],
    "Russia":   ["russia","russian","moscow","kremlin"],
}

REL_PATTERNS = [
    (r'\b(threatens?|attacks?|fires?\s+on|violat)\b',          "THREATENS"),
    (r'\b(invests?|funds?|financ|allocat)\w*\b',               "FUNDS"),
    (r'\b(allies?|cooperat|partner|joint)\w*\b',               "ALLIES_WITH"),
    (r'\b(trade|imports?|exports?|bilateral)\w*\b',            "TRADES_WITH"),
    (r'\b(sanction|ban|restrict|embargo)\w*\b',                "SANCTIONS"),
    (r'\b(border|loc|lac|ceasefire|infiltrat)\w*\b',           "BORDER_TENSION"),
    (r'\b(drought|flood|cyclone|monsoon|rainfall)\w*\b',       "CLIMATE_EVENT"),
    (r'\b(inflation|price\s+rise|price\s+hike|surge)\w*\b',   "PRICE_PRESSURE"),
]


def extract_entities(text: str, domain: str) -> dict:
    doc = nlp(text[:2000])
    nations, orgs, persons, temporal, rels = [], [], [], [], []

    for ent in doc.ents:
        if ent.label_ in ("GPE", "LOC"):
            for canonical, aliases in NATION_MAP.items():
                if any(a in ent.text.lower() for a in aliases):
                    if canonical not in nations:
                        nations.append(canonical)
        elif ent.label_ == "ORG":
            clean = ent.text.strip()
            if len(clean) > 2 and clean not in orgs:
                orgs.append(clean)
        elif ent.label_ == "PERSON":
            clean = ent.text.strip()
            if len(clean) > 3 and clean not in persons:
                persons.append(clean)
        elif ent.label_ == "DATE":
            temporal.append(ent.text)

    for pattern, rel_type in REL_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            rels.append(rel_type)

    return {
        "nations":       nations[:4],
        "orgs":          orgs[:4],
        "persons":       persons[:3],
        "temporal":      temporal[:3],
        "relationships": rels,
        "domain":        domain
    }


def write_to_graph(article: dict, entities: dict):
    event_id = f"EVT_LIVE_{article['id'][:10].upper()}"
    title    = article.get("title", "")[:200]
    domain   = article.get("domain", "geopolitics")

    with driver.session(database=DB) as s:
        s.run("""
            MERGE (e:Event {id:$id})
            SET e.title=$title, e.source=$source, e.domain=$domain,
                e.content=$content, e.published_at=$published_at,
                e.severity=$severity, e.live=true, e.updated=datetime()
        """,
        id=event_id, title=title,
        source=article.get("source","Unknown"),
        domain=domain,
        content=article.get("content","")[:400],
        published_at=article.get("published_at",""),
        severity=round(0.35 + abs(hash(title) % 45) / 100, 2))

        for nation in entities["nations"]:
            s.run("""
                MATCH (n:Nation {name:$nation})
                MATCH (e:Event {id:$eid})
                MERGE (e)-[r:MENTIONS]->(n)
                SET r.updated=datetime()
            """, nation=nation, eid=event_id)

        for org_name in entities["orgs"][:2]:
            s.run("""
                MERGE (o:Organization {name:$name})
                SET o.domain=$domain, o.type='Detected', o.updated=datetime()
                WITH o
                MATCH (e:Event {id:$eid})
                MERGE (o)-[r:INVOLVED_IN]->(e)
                SET r.updated=datetime()
            """, name=org_name[:80], domain=domain, eid=event_id)

        if "BORDER_TENSION" in entities["relationships"] \
           and "India" in entities["nations"] \
           and "Pakistan" in entities["nations"]:
            s.run("""
                MATCH (e:Event {id:$eid})
                MATCH (n:Nation {name:'India'})
                MERGE (e)-[r:AFFECTS_SECURITY]->(n)
                SET r.confidence=0.70, r.updated=datetime()
            """, eid=event_id)


def run_consumer():
    print("\n=== ANVAY NER Consumer ===")
    print(f"Database : {DB}")
    print(f"Topics   : {TOPICS}")
    print("Press Ctrl+C to stop.\n")

    for attempt in range(15):
        try:
            consumer = KafkaConsumer(
                *TOPICS,
                bootstrap_servers=[os.getenv("KAFKA_BOOTSTRAP","localhost:9092")],
                auto_offset_reset="earliest",
                value_deserializer=lambda x: json.loads(x.decode("utf-8")),
                group_id="anvay-ner-group-v3",
                consumer_timeout_ms=5000,
            )
            print("✓ Kafka consumer connected\n")
            break
        except Exception as e:
            print(f"  Waiting for Kafka... attempt {attempt+1}/15 ({e})")
            time.sleep(4)

    processed = 0
    for msg in consumer:
        article = msg.value
        if not article.get("content") and not article.get("title"):
            continue
        text     = (article.get("title","") + " " + article.get("content","")).strip()
        domain   = article.get("domain","geopolitics")
        entities = extract_entities(text, domain)
        write_to_graph(article, entities)
        processed += 1
        print(f"[{processed:04d}] {domain:<15} | "
              f"{article.get('title','')[:55]:<55} | "
              f"nations={entities['nations']}")

    print(f"\n✓ Consumer finished. {processed} articles written to Neo4j ({DB}).")
    consumer.close()


if __name__ == "__main__":
    run_consumer()
