# backend/rag/orchestrator.py
import re
from .graph_store import multi_hop_traversal, assemble_context, SYSTEM_PROMPT
from sarvam_client import SarvamClient

sarvam = SarvamClient()

# Intent patterns → max hops
INTENT_MAP = {
    "relational": (5, r'\b(affect|impact|influence|cause|connect|link|relate|how does|chain|because)\b'),
    "threat":     (5, r'\b(threat|risk|danger|attack|war|conflict|tension|violent)\b'),
    "temporal":   (4, r'\b(when|trend|history|over time|trajectory|predict|escalat|growing)\b'),
    "economic":   (3, r'\b(price|gdp|inflation|trade|investment|cad|rupee|budget|deficit)\b'),
    "geographic": (4, r'\b(border|loc|lac|region|district|state|kashmir|ladakh|vidarbha)\b'),
    "defence":    (4, r'\b(military|army|weapon|drdo|pla|troops|exercise|ceasefire)\b'),
}

ENTITY_MAP = {
    "India":    ["india","indian","bharat","new delhi","modi"],
    "China":    ["china","chinese","beijing","prc","xi jinping","cpec"],
    "Pakistan": ["pakistan","pakistani","islamabad","rawalpindi","isi"],
    "Vidarbha": ["vidarbha","vidarbha drought","maharashtra drought"],
    "CPEC":     ["cpec","china pakistan economic corridor","gwadar"],
    "PLA":      ["pla","peoples liberation army","chinese military"],
    "IMD":      ["imd","india meteorological","weather india"],
    "RBI":      ["rbi","reserve bank","rbi india"],
    "LoC":      ["loc","line of control","ceasefire violations","border firing"],
    "LAC":      ["lac","line of actual control","depsang","galwan"],
}


def parse_intent(query: str) -> dict:
    q_lower = query.lower()
    intent, max_hops = "informational", 3

    for i_name, (hops, pattern) in INTENT_MAP.items():
        if re.search(pattern, q_lower, re.IGNORECASE):
            intent, max_hops = i_name, hops
            break

    seeds = []
    for entity, keywords in ENTITY_MAP.items():
        if any(k in q_lower for k in keywords):
            seeds.append(entity)

    if not seeds:
        seeds = ["India"]

    return {"intent": intent, "entities": seeds, "max_hops": max_hops}


def run_query(query: str) -> dict:
    """Full pipeline: NLU → Graph → Context → LLM → Response."""

    # 1. Parse
    parsed = parse_intent(query)
    print(f"[ANVAY] intent={parsed['intent']} | entities={parsed['entities']} "
          f"| hops={parsed['max_hops']}")

    # 2. Graph traversal
    all_paths, all_bridges, all_alerts = [], [], []
    for entity in parsed["entities"]:
        result = multi_hop_traversal(entity, parsed["max_hops"])
        all_paths.extend(result["paths"])
        all_bridges.extend(result["bridges"])
        all_alerts.extend(result["alerts"])

    # Deduplicate
    seen, deduped = set(), []
    for p in all_paths:
        sig = tuple(n.get("name","") for n in p["chain"])
        if sig not in seen:
            seen.add(sig)
            deduped.append(p)

    traversal_result = {
        "paths":        deduped,
        "bridges":      all_bridges,
        "alerts":       all_alerts,
        "query_entity": ", ".join(parsed["entities"])
    }

    # 3. Assemble context
    context = assemble_context(traversal_result, query)

    # 4. LLM
    response_text = sarvam.generate(SYSTEM_PROMPT, f"{context}\n\nUser Query: {query}")

    # 5. Build output
    citations  = _build_citations(deduped)
    confidence = _compute_confidence(deduped)

    return {
        "query":    query,
        "intent":   parsed["intent"],
        "entities": parsed["entities"],
        "response": response_text,
        "citations": citations,
        "graph_paths": [
            {
                "chain": [
                    {
                        "name":   n.get("name","?"),
                        "label":  n.get("label",""),
                        "domain": n.get("domain","")
                    }
                    for n in p["chain"] if n.get("name")
                ],
                "depth": p["depth"]
            }
            for p in deduped[:6]
        ],
        "bridges":        all_bridges[:5],
        "alerts":         all_alerts[:3],
        "hops_traversed": max((p["depth"] for p in deduped), default=0),
        "confidence":     confidence,
        "paths_found":    len(deduped),
    }


def _build_citations(paths: list) -> list:
    seen, cits = set(), []
    for p in paths[:10]:
        for n in p.get("chain", []):
            key = f"{n.get('label')}:{n.get('name')}"
            if key not in seen and n.get("name"):
                cits.append({
                    "entity":     n.get("name"),
                    "type":       n.get("label"),
                    "domain":     n.get("domain"),
                    "confidence": round(0.5 + 0.4 * (p.get("depth", 1) / 5), 2)
                })
                seen.add(key)
    return cits[:12]


def _compute_confidence(paths: list) -> float:
    if not paths:
        return 0.10
    avg_depth = sum(p.get("depth", 1) for p in paths) / len(paths)
    return round(min(0.95, 0.35 + avg_depth * 0.08 + len(paths) * 0.015), 2)
