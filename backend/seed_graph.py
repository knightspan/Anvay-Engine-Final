# backend/seed_temporal_fix.py
# Run this once: python seed_temporal_fix.py
# It adds temporal snapshots AND fixes the name property so /api/temporal works

from neo4j import GraphDatabase
from dotenv import load_dotenv
import os, json

load_dotenv()

URI  = os.getenv("NEO4J_URI",      "neo4j://127.0.0.1:7687")
USER = os.getenv("NEO4J_USER",     "neo4j")
PASS = os.getenv("NEO4J_PASSWORD", "anvay2025")
DB   = "anvay"

print(f"\nConnecting to  : {URI}")
print(f"Database       : {DB}\n")

driver = GraphDatabase.driver(URI, auth=(USER, PASS))

def fix_names(tx):
    """Add .name property to Event and Phenomenon nodes so temporal lookup works."""
    tx.run("""
        MATCH (e:Event)
        WHERE e.name IS NULL
        SET e.name = e.id
    """)
    tx.run("""
        MATCH (p:Phenomenon)
        WHERE p.name IS NULL
        SET p.name = p.id
    """)
    print("  ✓ name properties fixed on Event + Phenomenon nodes")

def clear_old_snapshots(tx):
    """Remove any broken snapshots from previous runs."""
    result = tx.run("""
        MATCH (s:StateSnapshot)
        DETACH DELETE s
        RETURN count(s) as deleted
    """)
    print(f"  ✓ Old snapshots cleared")

def seed_temporal(tx):
    snapshots = [
        ("EVT002", "Event",
         [
             {"severity": 0.45, "violations": 4,  "month": "Nov 2025"},
             {"severity": 0.52, "violations": 6,  "month": "Dec 2025"},
             {"severity": 0.58, "violations": 8,  "month": "Jan 2026"},
             {"severity": 0.71, "violations": 12, "month": "Feb-early 2026"},
             {"severity": 0.82, "violations": 17, "month": "Feb-end 2026"},
         ]),
        ("PHE001", "Phenomenon",
         [
             {"severity": 0.30, "rainfall_deficit": 15, "month": "Nov 2025"},
             {"severity": 0.48, "rainfall_deficit": 28, "month": "Dec 2025"},
             {"severity": 0.61, "rainfall_deficit": 41, "month": "Jan 2026"},
             {"severity": 0.68, "rainfall_deficit": 55, "month": "Feb 2026"},
         ]),
    ]

    total = 0
    for entity_id, label, states in snapshots:
        for i, state in enumerate(states):
            tx.run(f"""
                MATCH (e:{label} {{id: $eid}})
                CREATE (snap:StateSnapshot {{
                    entity_id:     $eid,
                    entity_label:  $label,
                    snapshot_time: datetime() - duration({{days: $days_ago}}),
                    state:         $state,
                    month:         $month
                }})
                MERGE (e)-[:HAS_SNAPSHOT]->(snap)
            """,
            eid=entity_id,
            label=label,
            state=json.dumps(state),
            month=state.get("month", ""),
            days_ago=(len(states) - i) * 30)
            total += 1

    print(f"  ✓ {total} temporal snapshots seeded")

def verify(tx):
    count = tx.run("MATCH (s:StateSnapshot) RETURN count(s) as c").single()["c"]
    print(f"  ✓ Verification: {count} StateSnapshot nodes in database")

    # Also verify the temporal endpoint will work
    rows = tx.run("""
        MATCH (n {id:'EVT002'})-[:HAS_SNAPSHOT]->(snap:StateSnapshot)
        RETURN snap.month AS month, snap.state AS state
        ORDER BY snap.snapshot_time
    """).data()
    print(f"  ✓ EVT002 has {len(rows)} trajectory points:")
    for r in rows:
        state = json.loads(r['state'])
        print(f"    {r['month']}: severity={state.get('severity')}, violations={state.get('violations')}")

    rows2 = tx.run("""
        MATCH (n {id:'PHE001'})-[:HAS_SNAPSHOT]->(snap:StateSnapshot)
        RETURN snap.month AS month, snap.state AS state
        ORDER BY snap.snapshot_time
    """).data()
    print(f"  ✓ PHE001 has {len(rows2)} trajectory points:")
    for r in rows2:
        state = json.loads(r['state'])
        print(f"    {r['month']}: severity={state.get('severity')}, deficit={state.get('rainfall_deficit')}")

if __name__ == "__main__":
    print("=== Fixing ANVAY Temporal Snapshots ===\n")
    with driver.session(database=DB) as s:
        s.execute_write(fix_names)
        s.execute_write(clear_old_snapshots)
        s.execute_write(seed_temporal)
        s.execute_read(verify)

    print("\n✓ Done! Now refresh http://localhost:5173 and click Trajectory tab.")
    driver.close()