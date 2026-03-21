# backend/seed_graph.py
# Run this once: python seed_graph.py
# It creates the base ontological nodes AND temporal snapshots for the demo.

from neo4j import GraphDatabase
from dotenv import load_dotenv
import os, json

load_dotenv()

URI  = os.getenv("NEO4J_URI",      "neo4j://127.0.0.1:7687")
USER = os.getenv("NEO4J_USER",     "neo4j")
PASS = os.getenv("NEO4J_PASSWORD", "anvay2025")
DB   = "neo4j"

print(f"\nConnecting to  : {URI}")
print(f"Database       : {DB}\n")

driver = GraphDatabase.driver(URI, auth=(USER, PASS))

def clear_db(tx):
    print("  ... Clearing database")
    tx.run("MATCH (n) DETACH DELETE n")

def seed_base(tx):
    print("  ... Seeding base nodes (Nations, Phenomenon, Events)")
    
    # 1. Nations
    tx.run("""
        UNWIND [
            {id:'IND', name:'India', domain:'geopolitics', severity:0.12},
            {id:'CHN', name:'China', domain:'geopolitics', severity:0.45},
            {id:'PAK', name:'Pakistan', domain:'geopolitics', severity:0.55}
        ] AS n
        MERGE (node:Nation {id: n.id})
        SET node.name = n.name, node.domain = n.domain, node.severity = n.severity
    """)

    # 2. Phenomenon
    tx.run("""
        MERGE (p:Phenomenon {id: 'PHE001'})
        SET p.name='Drought 2026', p.domain='climate', p.severity=0.72,
            p.summary='Widespread rainfall deficit in Western/Central India'
    """)

    # 3. Events & Relationships (The "Killer Chain")
    tx.run("""
        MERGE (e1:Event {id: 'EVT003'})
        SET e1.name='Food Price Surge', e1.domain='economics', e1.severity=0.68,
            e1.summary='Wheat and pulse prices rising due to crop failure'
        
        MERGE (e2:Event {id: 'EVT004'})
        SET e2.name='Civil Unrest', e2.domain='society', e2.severity=0.75,
            e2.summary='Protests in major cities over food inflation'
        
        MERGE (e3:Event {id: 'EVT007'})
        SET e3.name='Political Instability', e3.domain='parliamentary', e3.severity=0.82,
            e3.summary='No-confidence motion and emergency measures debated in Lok Sabha'
            
        MERGE (e4:Event {id: 'EVT002'})
        SET e4.name='Ceasefire Violation', e4.domain='defence', e4.severity=0.88,
            e4.summary='Heavy cross-border shelling reported at LoC'

        WITH e1, e2, e3, e4
        MATCH (p:Phenomenon {id: 'PHE001'})
        MATCH (ind:Nation {name: 'India'})
        MATCH (pak:Nation {name: 'Pakistan'})

        // The Chain
        MERGE (p)-[r1:TRIGGERS]->(e1) SET r1.confidence=0.92, r1.lag_days=30
        MERGE (e1)-[r2:CAUSES]->(e2)  SET r2.confidence=0.88, r2.lag_days=15
        MERGE (e2)-[r3:ESCALATES_TO]->(e3) SET r3.confidence=0.85, r3.lag_days=7
        MERGE (e3)-[r4:CORRELATES_WITH]->(e4) SET r4.confidence=0.78, r4.domain_bridge='geopolitics'
        
        // Citations
        MERGE (e4)-[:MENTIONS]->(ind)
        MERGE (e4)-[:MENTIONS]->(pak)
        MERGE (e2)-[:AFFECTS_SECURITY]->(ind)
    """)
    print("  OK: Base graph seeded")

def seed_temporal(tx):
    print("  ... Seeding temporal snapshots")
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

    print(f"  OK: {total} temporal snapshots seeded")

def verify(tx):
    n_count = tx.run("MATCH (n) RETURN count(n) as c").single()["c"]
    s_count = tx.run("MATCH (s:StateSnapshot) RETURN count(s) as c").single()["c"]
    print(f"\nVerification:")
    print(f"  Total Nodes        : {n_count}")
    print(f"  StateSnapshots     : {s_count}")
    print("  Demo Chain Status  : READY")

if __name__ == "__main__":
    print("=== ANVAY Knowledge Graph Setup ===\n")
    with driver.session(database=DB) as s:
        s.execute_write(clear_db)
        s.execute_write(seed_base)
        s.execute_write(seed_temporal)
        s.execute_read(verify)

    print("\nOK: Seeding Complete!")
    print("1. Start Backend:  python main.py")
    print("2. Start Frontend: cd frontend/anvay-dashboard && npm run dev")
    driver.close()