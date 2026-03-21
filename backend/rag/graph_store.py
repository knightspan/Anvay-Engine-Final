# backend/rag/graph_store.py
import os
from neo4j import GraphDatabase
from dotenv import load_dotenv

load_dotenv()

URI  = os.getenv("NEO4J_URI",      "neo4j://127.0.0.1:7687")
USER = os.getenv("NEO4J_USER",     "neo4j")
PASS = os.getenv("NEO4J_PASSWORD", "anvay2025")
DB   = "anvay"

driver = GraphDatabase.driver(URI, auth=(USER, PASS))

SYSTEM_PROMPT = """You are ANVAY — India's Sovereign Strategic Intelligence System.
You reason over a live ontological knowledge graph of geopolitical, defence,
economic, climate, parliamentary, and society data.

STRICT RULES:
1. Answer ONLY using the graph context provided. Never invent facts.
2. Cite every claim: write [Node: EntityName | Conf: X.XX] after each claim.
3. Explicitly identify cross-domain connections — this is your core capability.
4. Flag causal chains and temporal lag relationships when present.
5. End every response with: CONFIDENCE SCORE: [0.0-1.0]
6. If query is in Hindi, respond in Hindi. If English, respond in English.
7. Keep responses under 300 words — precise, not verbose.
"""


def multi_hop_traversal(start_entity: str, max_hops: int = 5) -> dict:
    """Core GraphRAG: traverse up to max_hops from a seed entity."""
    with driver.session(database=DB) as s:

        # Variable-depth traversal
        result = s.run(f"""
            MATCH path = (start)-[*1..{max_hops}]-(end)
            WHERE (start.name = $entity
                OR start.title = $entity
                OR start.id    = $entity)
              AND NOT end:StateSnapshot
            WITH path,
                 relationships(path) AS rels,
                 nodes(path)         AS nds
            RETURN
              [n IN nds | {{
                label:    labels(n)[0],
                name:     coalesce(n.name, n.title, n.id),
                domain:   n.domain,
                severity: n.severity,
                summary:  n.summary
              }}] AS chain,
              [r IN rels | {{
                type:          type(r),
                confidence:    r.confidence,
                lag_days:      r.lag_days,
                domain_bridge: r.domain_bridge
              }}] AS edges,
              length(path) AS depth
            ORDER BY depth DESC
            LIMIT 25
        """, entity=start_entity)
        paths = [
            {"chain": r["chain"], "edges": r["edges"], "depth": r["depth"]}
            for r in result
        ]

        # Cross-domain bridge detection
        bridge_result = s.run("""
            MATCH (center)-[r1]-(n1)
            MATCH (center)-[r2]-(n2)
            WHERE n1.domain IS NOT NULL
              AND n2.domain IS NOT NULL
              AND n1.domain <> n2.domain
              AND NOT center:StateSnapshot
            WITH DISTINCT center,
                 collect(DISTINCT n1.domain) + collect(DISTINCT n2.domain) AS all_domains
            RETURN
              coalesce(center.name, center.title, center.id) AS bridge_entity,
              labels(center)[0] AS type,
              all_domains       AS domains
            LIMIT 8
        """)
        bridges = [
            {
                "bridge_entity": r["bridge_entity"],
                "type":          r["type"],
                "domains":       list(set(r["domains"]))
            }
            for r in bridge_result
        ]

        # High-severity alerts
        alert_result = s.run("""
            MATCH (e:Event) WHERE e.severity >= 0.70
            RETURN e.title   AS title,
                   e.severity AS severity,
                   e.domain   AS domain,
                   e.summary  AS summary
            ORDER BY e.severity DESC
            LIMIT 5
        """)
        alerts = [dict(r) for r in alert_result]

    return {
        "paths":        paths,
        "bridges":      bridges,
        "alerts":       alerts,
        "query_entity": start_entity
    }


def assemble_context(traversal: dict, query: str) -> str:
    """Convert graph traversal results into a structured LLM context."""
    parts = [
        "=== ANVAY GRAPH INTELLIGENCE CONTEXT ===",
        f"Query         : {query}",
        f"Traversal from: {traversal['query_entity']}",
        f"Paths found   : {len(traversal['paths'])}",
        ""
    ]

    parts.append("--- CAUSAL / RELATIONSHIP CHAINS ---")
    for i, p in enumerate(traversal["paths"][:10]):
        chain_names = [
            f"[{n.get('label','')}]{n.get('name','?')}"
            for n in p["chain"] if n.get("name")
        ]
        edge_desc = " | ".join([
            f"{e.get('type','')}("
            f"conf:{e.get('confidence', 0):.2f}"
            + (f",lag:{e.get('lag_days')}d"        if e.get("lag_days")      else "")
            + (f",bridge:{e.get('domain_bridge')}" if e.get("domain_bridge") else "")
            + ")"
            for e in p["edges"] if e.get("type")
        ])
        parts.append(f"\nChain {i+1} ({p['depth']} hops): {' -> '.join(chain_names)}")
        if edge_desc:
            parts.append(f"  Relations: {edge_desc}")
        for n in p["chain"]:
            if n.get("summary"):
                parts.append(
                    f"  [{n.get('label')}] {n.get('name')}: "
                    f"{str(n.get('summary',''))[:120]}"
                )

    if traversal["bridges"]:
        parts.append("\n--- CROSS-DOMAIN BRIDGE ENTITIES ---")
        for b in traversal["bridges"][:5]:
            parts.append(
                f"  BRIDGE: {b.get('bridge_entity')} ({b.get('type')}) "
                f"connects: {b.get('domains')}"
            )

    if traversal["alerts"]:
        parts.append("\n--- ACTIVE HIGH-SEVERITY ALERTS ---")
        for a in traversal["alerts"][:3]:
            parts.append(
                f"  ALERT [{(a.get('domain') or '?').upper()}] "
                f"sev:{a.get('severity', 0):.2f} — {a.get('title','')}"
            )

    parts.append("\n=== CITE ALL CLAIMS USING NODES ABOVE ===")
    return "\n".join(parts)
