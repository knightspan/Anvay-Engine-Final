# backend/ingestors/news_producer.py
import json, time, hashlib, requests
from datetime import datetime
from kafka import KafkaProducer
from dotenv import load_dotenv
import os

load_dotenv()

NEWSAPI_KEY     = os.getenv("NEWSAPI_KEY", "")
KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP", "localhost:9092")

DOMAIN_QUERIES = {
    "anvay-geopolitics": [
        "India China border 2026",
        "India Pakistan relations 2026",
        "CPEC investment China Pakistan",
        "South Asia geopolitics 2026",
    ],
    "anvay-defence": [
        "India military LAC 2026",
        "India China PLA exercise",
        "India DRDO defence",
        "LoC ceasefire India Pakistan 2026",
    ],
    "anvay-economics": [
        "India wheat price inflation 2026",
        "RBI India GDP 2026",
        "India trade deficit current account",
        "India rupee exchange rate",
    ],
    "anvay-climate": [
        "India drought 2026 Maharashtra",
        "India monsoon IMD 2026",
        "India water crisis agriculture",
    ],
    "anvay-society": [
        "India civil unrest protest food prices",
        "India social tension 2026",
    ],
    "anvay-parliamentary": [
        "India parliament Lok Sabha 2026",
        "India government budget policy",
    ],
}


def make_producer() -> KafkaProducer:
    for attempt in range(12):
        try:
            p = KafkaProducer(
                bootstrap_servers=[KAFKA_BOOTSTRAP],
                value_serializer=lambda x: json.dumps(x, default=str).encode("utf-8"),
                acks="all",
                retries=3,
            )
            print("✓ Kafka producer connected")
            return p
        except Exception as e:
            print(f"  Waiting for Kafka... attempt {attempt+1}/12 ({e})")
            time.sleep(5)
    raise RuntimeError("Could not connect to Kafka after 12 attempts")


def fetch_newsapi(query: str, topic: str, producer: KafkaProducer) -> int:
    if not NEWSAPI_KEY or NEWSAPI_KEY == "paste_your_newsapi_key_here":
        return 0
    url = (
        "https://newsapi.org/v2/everything"
        f"?q={requests.utils.quote(query)}"
        "&language=en&sortBy=publishedAt&pageSize=8"
    )
    try:
        r = requests.get(url, headers={"X-Api-Key": NEWSAPI_KEY}, timeout=12)
        r.raise_for_status()
        articles = r.json().get("articles", [])
        sent = 0
        for art in articles:
            msg = {
                "id":           hashlib.md5(art.get("url","").encode()).hexdigest(),
                "title":        art.get("title", "")[:200],
                "source":       art.get("source", {}).get("name", ""),
                "url":          art.get("url", ""),
                "content":      (art.get("content") or art.get("description") or "")[:600],
                "published_at": art.get("publishedAt", datetime.now().isoformat()),
                "query":        query,
                "domain":       topic.replace("anvay-", ""),
                "ingested_at":  datetime.now().isoformat(),
            }
            producer.send(topic, value=msg)
            sent += 1
        return sent
    except Exception as e:
        print(f"  NewsAPI error for '{query}': {e}")
        return 0


def fetch_gdelt(producer: KafkaProducer) -> int:
    """GDELT is free — no API key required."""
    url = ("http://api.gdeltproject.org/api/v2/summary/summary"
           "?d=lastday&t=summary&fmt=json")
    try:
        r = requests.get(url, timeout=20)
        r.raise_for_status()
        data  = r.json()
        count = 0
        for ev in data.get("events", [])[:15]:
            msg = {
                "id":           f"GDELT_{ev.get('id','unknown')}",
                "title":        ev.get("title", ""),
                "source":       "GDELT",
                "content":      ev.get("summary", ev.get("title", ""))[:500],
                "published_at": datetime.now().isoformat(),
                "domain":       "geopolitics",
                "tone":         ev.get("tone", "0"),
                "ingested_at":  datetime.now().isoformat(),
            }
            producer.send("anvay-geopolitics", value=msg)
            count += 1
        print(f"  ✓ GDELT: {count} events produced")
        return count
    except Exception as e:
        print(f"  GDELT error: {e}")
        return 0


if __name__ == "__main__":
    print("\n=== ANVAY News Ingestor ===\n")
    producer = make_producer()
    total    = 0

    print("[1] Fetching from NewsAPI...")
    for topic, queries in DOMAIN_QUERIES.items():
        for query in queries:
            n = fetch_newsapi(query, topic, producer)
            if n:
                print(f"  ✓ {topic}: {n} articles — '{query}'")
            total += n
            time.sleep(0.4)

    print("\n[2] Fetching from GDELT...")
    total += fetch_gdelt(producer)

    producer.flush()
    print(f"\n✓ Total: {total} messages sent to Kafka.")
    print("The NER consumer will process them into Neo4j automatically.")
    producer.close()
