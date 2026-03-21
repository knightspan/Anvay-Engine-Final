// src/App.jsx
import { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import GraphCanvas from "./components/GraphCanvas";
import MapView from "./components/MapView";
import TemporalChart from "./components/TemporalChart";
import "./App.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const LANG_OPTIONS = [
  { code: "hi-IN", label: "हिंदी" },
  { code: "en-IN", label: "English" },
  { code: "mr-IN", label: "मराठी" },
  { code: "ta-IN", label: "தமிழ்" },
];

const DOMAIN_COLOR = {
  geopolitics:"#F5911E", defence:"#EF4444", economics:"#22C55E",
  climate:"#3B82F6", society:"#A855F7", parliamentary:"#F59E0B", default:"#64748B",
};

export default function App() {
  const [query,        setQuery]        = useState("");
  const [result,       setResult]       = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [stats,        setStats]        = useState({});
  const [alerts,       setAlerts]       = useState([]);
  const [activeTab,    setActiveTab]    = useState("graph");
  const [chainDemo,    setChainDemo]    = useState(null);
  const [recording,    setRecording]    = useState(false);
  const [selectedNode, setSelectedNode] = useState(null);
  const [language,     setLanguage]     = useState("hi-IN");
  const [backendOk,    setBackendOk]    = useState(null);
  const mrRef = useRef(null);
  const chunksRef = useRef([]);

  useEffect(() => {
    const check = () =>
      axios.get(`${API}/api/stats`, { timeout: 3000 })
        .then(r  => { setStats(r.data); setBackendOk(true); })
        .catch(() => setBackendOk(false));
    check();
    const t = setInterval(check, 8000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    axios.get(`${API}/api/alerts`).then(r => setAlerts(r.data.alerts || [])).catch(() => {});
    axios.get(`${API}/api/chain-demo`).then(r => setChainDemo(r.data)).catch(() => {});
    const ws = new WebSocket("ws://localhost:8000/ws/live");
    ws.onmessage = () => {};
    return () => ws.close();
  }, []);

const handleQuery = useCallback(async (q) => {
  const text = (q || query).trim();
  if (!text) return;
  setLoading(true); setResult(null);
  try {
    const { data } = await axios.post(`${API}/api/jarvis/full`, {
      query: text,
      language: language   // hi-IN, en-IN, mr-IN, ta-IN
    });
    setResult(data);

    // ── Auto-play the spoken response ──
    if (data.audio_b64) {
      const bytes = Uint8Array.from(atob(data.audio_b64), c => c.charCodeAt(0));
      const blob  = new Blob([bytes], { type: "audio/wav" });
      const url   = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.play();
      audio.onended = () => URL.revokeObjectURL(url);
    }
  } catch {
    setResult({
      response: "Backend offline.\n\nFix: python main.py in backend folder.",
      confidence: 0, citations: [], graph_paths: [], bridges: [], alerts: [],
    });
  }
  setLoading(false);
}, [query, language]);
  const startRecording = async () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      const rec = new SR();
      rec.lang = language;
      rec.interimResults = false;
      rec.onstart  = () => setRecording(true);
      rec.onresult = e => {
        const t = e.results[0][0].transcript;
        setRecording(false); setQuery(t); handleQuery(t);
      };
      rec.onerror = e => {
        setRecording(false);
        if (e.error === "not-allowed") alert("Allow microphone in browser settings.");
      };
      rec.onend = () => setRecording(false);
      rec.start(); window._rec = rec; return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mrRef.current = mr; chunksRef.current = [];
      mr.ondataavailable = e => chunksRef.current.push(e.data);
      mr.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: "audio/wav" });
        const form = new FormData();
        form.append("audio", blob, "query.wav");
        form.append("language", language);
        try {
          const { data } = await axios.post(`${API}/api/jarvis/transcribe`, form);
          if (data.transcript) { setQuery(data.transcript); handleQuery(data.transcript); }
        } catch { /* silent */ }
        setRecording(false);
      };
      mr.start(); setRecording(true);
    } catch { alert("Microphone access denied."); }
  };

  const stopRecording = () => {
    window._rec?.stop(); window._rec = null;
    if (mrRef.current?.state === "recording") mrRef.current.stop();
    setRecording(false);
  };

  const playAudio = async (text) => {
    try {
      const resp = await axios.post(`${API}/api/jarvis/speak`,
        { text, language }, { responseType: "blob" });
      new Audio(URL.createObjectURL(new Blob([resp.data], { type: "audio/wav" }))).play();
    } catch { /* no API key */ }
  };

  return (
    <div className="app">

      {/* HEADER */}
      <header className="header">
        <div className="brand">
          <span className="brand-name">ANVAY</span>
          <span className="brand-hindi">अन्वय</span>
          <span className="brand-sub">Sovereign Intelligence Platform</span>
        </div>
        <div className="hstats">
          {[["Nodes",stats.total_nodes||0,"#F5911E"],["Nations",stats.Nation||0,"#22C55E"],
            ["Events",stats.Event||0,"#3B82F6"],["Relations",stats.relationships||0,"#A855F7"]
          ].map(([l,v,c])=>(
            <div className="hstat" key={l}>
              <span className="hstat-v" style={{color:c}}>{v}</span>
              <span className="hstat-l">{l}</span>
            </div>
          ))}
          <div className={`status-pill ${backendOk===true?"ok":backendOk===false?"err":"pending"}`}>
            <span className="sdot"/>
            {backendOk===true?"LIVE":backendOk===false?"OFFLINE":"..."}
          </div>
        </div>
      </header>

      {/* ALERT BAR */}
      {alerts.filter(a=>["CRITICAL","HIGH"].includes(a.alert_type)).length>0 && (
        <div className="alertbar">
          {alerts.filter(a=>["CRITICAL","HIGH"].includes(a.alert_type)).slice(0,4).map((a,i)=>(
            <div key={i} className="achip"
              style={{borderLeftColor:DOMAIN_COLOR[a.domain]||"#EF4444"}}>
              <span className="abadge"
                style={{color:a.alert_type==="CRITICAL"?"#EF4444":"#F59E0B",
                  background:a.alert_type==="CRITICAL"?"rgba(239,68,68,.15)":"rgba(245,158,11,.15)"}}>
                {a.alert_type}
              </span>
              <span className="amsg">{(a.title||"").slice(0,75)}</span>
              <span className="apct" style={{color:a.alert_type==="CRITICAL"?"#EF4444":"#F59E0B"}}>
                {((a.severity||0)*100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      )}

      {/* OFFLINE BANNER */}
      {backendOk===false && (
        <div className="offline-banner">
          ⚠️ Backend offline — run <code>python main.py</code> in the backend terminal, then refresh
        </div>
      )}

      {/* BODY */}
      <div className="body">

        {/* LEFT */}
        <div className="left">
          <div className="tabrow">
            {[["graph","🕸 Force Graph"],["map","🗺 Geospatial"],
              ["temporal","📈 Trajectory"],["chain","⛓ Chain Demo"]].map(([t,l])=>(
              <button key={t} className={`tabpill ${activeTab===t?"active":""}`}
                onClick={()=>setActiveTab(t)}>{l}</button>
            ))}
          </div>
          <div className="vizbox">
            {activeTab==="graph"    && <GraphCanvas onNodeClick={setSelectedNode}/>}
            {activeTab==="map"      && <MapView/>}
            {activeTab==="temporal" && <TemporalChart/>}
            {activeTab==="chain"    && <ChainView chain={chainDemo} domainColor={DOMAIN_COLOR}/>}
          </div>

          {selectedNode && (
            <div className="nodecard">
              <div className="nc-label"
                style={{color:DOMAIN_COLOR[selectedNode.domain]||DOMAIN_COLOR.default}}>
                [{selectedNode.label?.toUpperCase()}]
                {selectedNode.domain && ` · ${selectedNode.domain}`}
              </div>
              <div className="nc-name">{selectedNode.name}</div>
              {selectedNode.severity!=null && (
                <div className="nc-meta">
                  Severity:&nbsp;
                  <strong style={{color:selectedNode.severity>0.7?"#EF4444":"#F59E0B"}}>
                    {((selectedNode.severity||0)*100).toFixed(0)}%
                  </strong>
                </div>
              )}
              {selectedNode.summary && <div className="nc-sum">{selectedNode.summary}</div>}
              <button className="nc-btn"
                onClick={()=>handleQuery(`Tell me about ${selectedNode.name} and its strategic connections`)}>
                Query this entity →
              </button>
            </div>
          )}
        </div>

        {/* RIGHT */}
        <div className="right">

          {/* QUERY PANEL */}
          <div className="qpanel">
            <div className="qpanel-top">
              <span className="qpanel-title">Intelligence Query</span>
              <div className="langbar">
                {LANG_OPTIONS.map(opt=>(
                  <button key={opt.code}
                    className={`langbtn ${language===opt.code?"active":""}`}
                    onClick={()=>setLanguage(opt.code)}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="qrow">
              <textarea
                className="qta"
                value={query}
                onChange={e=>setQuery(e.target.value)}
                onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();handleQuery();}}}
                placeholder={
                  language==="hi-IN"?"हिंदी या English में पूछें…\nजैसे: CPEC का भारत पर क्या असर है?":
                  language==="mr-IN"?"मराठी किंवा English मध्ये विचारा…":
                  "Ask in English or Hindi…\ne.g. How does CPEC affect India's security?"
                }
                rows={3}
              />
              <div className="qbtns">
                <button className="btn-go" onClick={()=>handleQuery()} disabled={loading}>
                  {loading?<span className="spin-sm"/>:"QUERY"}
                </button>
                <button className={`btn-mic ${recording?"rec":""}`}
                  onClick={recording?stopRecording:startRecording}
                  title={`Speak in ${LANG_OPTIONS.find(l=>l.code===language)?.label}`}>
                  {recording?"⏹":"🎙"}
                </button>
              </div>
            </div>

            <div className="quickrow">
              <span className="ql">Try:</span>
              {[
                ["🌾 Drought→LoC","What is the connection between Vidarbha drought and Line of Control tensions?"],
                ["🏗 CPEC","How does Chinese CPEC investment affect India security?"],
                ["🍞 Food","What are the causes of food price inflation in India 2026?"],
                ["⚔ LAC","What is happening at the LAC and its strategic implications?"],
              ].map(([l,q])=>(
                <button key={l} className="qchip"
                  onClick={()=>{setQuery(q);handleQuery(q);}}>{l}</button>
              ))}
            </div>
          </div>

          {/* RESPONSE PANEL */}
          <div className="rpanel">
            {loading && (
              <div className="rloading">
                <div className="loading-ring"/>
                <div className="rloading-msg">GraphRAG traversal in progress…</div>
                <div className="rloading-sub">Traversing ontological graph across 6 domains</div>
              </div>
            )}

            {result&&!loading&&(
              <div className="rresult">
                <div className="rmeta">
                  <span className="mtag" style={{color:"#00D4FF",background:"rgba(0,212,255,.12)"}}>
                    {result.intent||"informational"}
                  </span>
                  <span className="mtag" style={{color:"#22C55E",background:"rgba(34,197,94,.12)"}}>
                    {result.hops_traversed||0} hops
                  </span>
                  <span className="mtag" style={{color:"#3B82F6",background:"rgba(59,130,246,.12)"}}>
                    {result.paths_found||0} paths
                  </span>
                  <span className="mtag" style={{color:"#F59E0B",background:"rgba(245,158,11,.12)"}}>
                    {((result.confidence||0)*100).toFixed(0)}% confidence
                  </span>
                  <button className="jbtn"
                    onClick={()=>playAudio((result.response||"").slice(0,500))}>
                    🔊 JARVIS
                  </button>
                </div>

                <div className="rtext">{result.response}</div>

                {result.graph_paths?.length>0&&(
                  <div className="rsec">
                    <div className="rsec-t">📍 Graph Traversal Paths</div>
                    {result.graph_paths.slice(0,5).map((p,i)=>(
                      <div key={i} className="prow">
                        <span className="phops">{p.depth}h</span>
                        <span className="pchain">
                          {(p.chain||[]).map(n=>n.name).filter(Boolean).join(" → ")}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {result.bridges?.length>0&&(
                  <div className="rsec">
                    <div className="rsec-t">🌉 Cross-domain Bridges</div>
                    {result.bridges.slice(0,3).map((b,i)=>(
                      <div key={i} className="brow">
                        <span className="bent">{b.bridge_entity}</span>
                        <span className="bdoms">{(b.domains||[]).join(" ↔ ")}</span>
                      </div>
                    ))}
                  </div>
                )}

                {result.citations?.length>0&&(
                  <div className="rsec">
                    <div className="rsec-t">📚 Citation Trail</div>
                    {result.citations.slice(0,8).map((c,i)=>(
                      <div key={i} className="crow">
                        <span className="cnum">[{i+1}]</span>
                        <span className="cent"
                          style={{color:DOMAIN_COLOR[c.domain]||"#94A3B8"}}>{c.entity}</span>
                        <span className="cmeta">{c.type} · {((c.confidence||0)*100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {!result&&!loading&&(
              <div className="rempty">
                <div className="ri">◈</div>
                <div className="rt">Query the Intelligence Graph</div>
                <div className="rs">Select a language above, then type or speak your question</div>
                <div className="rs">Hindi · Marathi · Tamil · English</div>
                <div className="rh">5-hop traversal · 6 strategic domains · Live graph</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ChainView({ chain, domainColor }) {
  if (!chain) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",
      color:"#334155",fontFamily:"monospace",fontSize:14}}>
      Loading chain… ensure FastAPI is running on port 8000
    </div>
  );
  if (chain.error) return (
    <div style={{padding:24,color:"#EF4444",fontFamily:"monospace",fontSize:13,lineHeight:2}}>
      {chain.error}<br/>Run seed_graph.py to fix.
    </div>
  );
  return (
    <div className="chainview">
      <div className="cv-title">
        <span>⛓ Killer Demo Chain</span>
        <span className="cv-desc">{chain.description}</span>
      </div>
      {(chain.chain||[]).map((node,i)=>(
        <div key={i}>
          <div className="cnode"
            style={{borderLeftColor:domainColor[node.domain]||"#64748B",
              background:`${domainColor[node.domain]||"#64748B"}12`}}>
            <span className="cn-badge"
              style={{color:domainColor[node.domain]||"#64748B",
                background:`${domainColor[node.domain]||"#64748B"}22`}}>
              {node.label} · {node.domain}
            </span>
            <div className="cn-name">{node.name}</div>
            {node.severity!=null&&(
              <div className="cn-sev">Severity: {((node.severity||0)*100).toFixed(0)}%</div>
            )}
            {node.summary&&<div className="cn-sum">{node.summary}</div>}
          </div>
          {i<(chain.chain||[]).length-1&&chain.edges?.[i]&&(
            <div className="cedge">
              <span className="ce-arr">↓</span>
              <span className="ce-type">{(chain.edges[i].type||"").replace(/_/g," ")}</span>
              {chain.edges[i].confidence&&(
                <span className="ce-conf">conf:{((chain.edges[i].confidence||0)*100).toFixed(0)}%</span>
              )}
              {chain.edges[i].lag_days&&<span className="ce-lag">lag:{chain.edges[i].lag_days}d</span>}
              {chain.edges[i].domain_bridge&&(
                <span className="ce-bridge">{chain.edges[i].domain_bridge}</span>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}