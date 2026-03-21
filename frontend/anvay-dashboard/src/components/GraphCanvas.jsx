// src/components/GraphCanvas.jsx
import { useEffect, useRef, useState } from "react";
import axios from "axios";

const LABEL_COLOR = {
  Nation:"#F5911E", Organization:"#22C55E", Event:"#3B82F6",
  Policy:"#A855F7", Phenomenon:"#EF4444", Person:"#F59E0B", default:"#64748B",
};
const LINK_COLOR = {
  THREATENS:"#EF4444", FUNDS:"#22C55E", ALLIES_WITH:"#3B82F6",
  CORRELATES_WITH:"#A855F7", CAUSES:"#F59E0B", ESCALATES_TO:"#EF4444",
  TRIGGERS:"#EF4444", INFLUENCES:"#F5911E", COMPETES_WITH:"#F5911E",
  IMPACTS:"#3B82F6", REPORTS:"#22C55E", default:"#1e3a5f",
};
const nodeR = n =>
  n.label==="Nation"?20 : n.label==="Phenomenon"?17 :
  n.label==="Event"?13 : n.label==="Policy"?11 : 9;

export default function GraphCanvas({ onNodeClick }) {
  const wrapRef  = useRef(null);
  const canvasRef = useRef(null);
  const stRef    = useRef({ animId:null, mounted:true, nodes:[], scale:1, tx:0, ty:0 });
  const [status,    setStatus]    = useState("loading");
  const [nodeCount, setNodeCount] = useState(0);
  const [hoveredNode, setHoveredNode] = useState(null);

  // zoom controls
  const zoom = (factor) => {
    const st = stRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cx = canvas.width/2, cy = canvas.height/2;
    st.tx = cx - (cx - st.tx) * factor;
    st.ty = cy - (cy - st.ty) * factor;
    st.scale = Math.max(0.08, Math.min(8, st.scale * factor));
  };

  const resetView = () => {
    const st = stRef.current;
    st.scale = 1; st.tx = 0; st.ty = 0;
  };

  useEffect(() => {
    stRef.current.mounted = true;
    const tryStart = () => {
      const wrap = wrapRef.current;
      const canvas = canvasRef.current;
      if (!wrap || !canvas) return;
      const W = wrap.offsetWidth, H = wrap.offsetHeight;
      if (W < 10 || H < 10) { requestAnimationFrame(tryStart); return; }
      canvas.width = W; canvas.height = H;

      axios.get("http://localhost:8000/api/graph/full")
        .then(({ data }) => {
          if (!stRef.current.mounted) return;
          setNodeCount(data.nodes.length);
          setStatus("ok");
          const ctx = canvas.getContext("2d");
          const onResize = () => { canvas.width = wrap.offsetWidth; canvas.height = wrap.offsetHeight; };
          window.addEventListener("resize", onResize);
          startSim(data.nodes, data.links, canvas, ctx, onNodeClick, stRef, setHoveredNode);
          stRef.current.cleanup = () => {
            window.removeEventListener("resize", onResize);
            if (stRef.current.animId) cancelAnimationFrame(stRef.current.animId);
          };
        })
        .catch(() => { if (stRef.current.mounted) setStatus("error"); });
    };
    const t = setTimeout(tryStart, 120);
    return () => {
      stRef.current.mounted = false;
      clearTimeout(t);
      if (stRef.current.animId) cancelAnimationFrame(stRef.current.animId);
      if (stRef.current.cleanup) stRef.current.cleanup();
    };
  }, []);

  return (
    <div ref={wrapRef} style={{ position:"relative", width:"100%", height:"100%", overflow:"hidden" }}>
      <canvas ref={canvasRef} style={{ display:"block", width:"100%", height:"100%" }} />

      {/* loading */}
      {status==="loading" && (
        <div style={{ position:"absolute",inset:0,display:"flex",alignItems:"center",
          justifyContent:"center",flexDirection:"column",gap:14,pointerEvents:"none" }}>
          <div style={{ width:36,height:36,border:"3px solid rgba(0,212,255,.15)",
            borderTopColor:"#00D4FF",borderRadius:"50%",animation:"spin 1s linear infinite" }}/>
          <div style={{ fontFamily:"monospace",fontSize:13,color:"#334155",letterSpacing:2 }}>
            Loading graph…
          </div>
        </div>
      )}

      {/* error */}
      {status==="error" && (
        <div style={{ position:"absolute",inset:0,display:"flex",alignItems:"center",
          justifyContent:"center",flexDirection:"column",gap:10,padding:24 }}>
          <div style={{ fontFamily:"monospace",fontSize:14,color:"#EF4444" }}>
            Cannot reach API
          </div>
          <div style={{ fontFamily:"monospace",fontSize:12,color:"#334155",textAlign:"center",lineHeight:1.8 }}>
            Make sure FastAPI is running:<br/>
            <code style={{ color:"#00D4FF" }}>python main.py</code>
          </div>
        </div>
      )}

      {/* zoom controls */}
      {status==="ok" && (
        <div style={{
          position:"absolute",bottom:14,right:14,
          display:"flex",flexDirection:"column",gap:4,
        }}>
          {[
            ["+","zoom in", ()=>zoom(1.25)],
            ["−","zoom out", ()=>zoom(0.8)],
            ["⊙","reset view", ()=>resetView()],
          ].map(([label, title, fn]) => (
            <button key={label} title={title} onClick={fn} style={{
              width:36,height:36,
              background:"rgba(4,6,14,.9)",
              border:"1px solid rgba(0,212,255,.25)",
              color:"#00D4FF",borderRadius:6,
              cursor:"pointer",fontSize:18,fontWeight:700,
              display:"flex",alignItems:"center",justifyContent:"center",
              transition:"all .18s",fontFamily:"monospace",
            }}
            onMouseEnter={e=>e.target.style.background="rgba(0,212,255,.15)"}
            onMouseLeave={e=>e.target.style.background="rgba(4,6,14,.9)"}>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* legend */}
      {status==="ok" && (
        <div style={{
          position:"absolute",top:10,left:10,
          display:"flex",flexDirection:"column",gap:4,
          background:"rgba(4,6,14,.8)",
          border:"1px solid rgba(0,180,255,.1)",
          borderRadius:8,padding:"10px 12px",
        }}>
          <div style={{ fontFamily:"monospace",fontSize:9,color:"#334155",
            letterSpacing:2,textTransform:"uppercase",marginBottom:4 }}>
            Node Types
          </div>
          {Object.entries(LABEL_COLOR).filter(([k])=>k!=="default").map(([label,color])=>(
            <div key={label} style={{ display:"flex",alignItems:"center",gap:8,
              fontSize:12,fontFamily:"monospace",color }}>
              <div style={{ width:8,height:8,borderRadius:"50%",background:color,
                boxShadow:`0 0 5px ${color}66` }}/>
              {label}
            </div>
          ))}
          <div style={{ marginTop:8,fontFamily:"monospace",fontSize:9,
            color:"#334155",letterSpacing:2,textTransform:"uppercase",marginBottom:4 }}>
            Edges
          </div>
          {[["THREATENS","#EF4444"],["FUNDS","#22C55E"],["ALLIES_WITH","#3B82F6"],
            ["CORRELATES","#A855F7"],["CAUSES","#F59E0B"]].map(([t,c])=>(
            <div key={t} style={{ display:"flex",alignItems:"center",gap:8,fontSize:11,fontFamily:"monospace",color:c }}>
              <div style={{ width:18,height:2,background:c,borderRadius:1 }}/>
              {t}
            </div>
          ))}
        </div>
      )}

      {/* hover tooltip */}
      {hoveredNode && (
        <div style={{
          position:"absolute",
          left: (hoveredNode.screenX||0)+14,
          top:  (hoveredNode.screenY||0)-10,
          background:"rgba(4,6,14,.95)",
          border:`1px solid ${LABEL_COLOR[hoveredNode.label]||"#64748B"}66`,
          borderRadius:8,padding:"10px 14px",
          pointerEvents:"none",zIndex:10,
          maxWidth:220,
        }}>
          <div style={{ fontFamily:"monospace",fontSize:10,letterSpacing:1.5,
            color:LABEL_COLOR[hoveredNode.label]||"#64748B",
            textTransform:"uppercase",marginBottom:5 }}>
            {hoveredNode.label}
          </div>
          <div style={{ fontSize:14,fontWeight:700,color:"#fff",marginBottom:4 }}>
            {hoveredNode.name}
          </div>
          {hoveredNode.domain && (
            <div style={{ fontSize:12,color:"#64748B" }}>Domain: {hoveredNode.domain}</div>
          )}
          {hoveredNode.severity!=null && (
            <div style={{ fontSize:12,color:hoveredNode.severity>0.7?"#EF4444":"#F59E0B" }}>
              Severity: {((hoveredNode.severity||0)*100).toFixed(0)}%
            </div>
          )}
          <div style={{ fontSize:11,color:"#334155",marginTop:6,fontFamily:"monospace" }}>
            Click to inspect · Drag to move
          </div>
        </div>
      )}

      {/* node count */}
      {status==="ok" && (
        <div style={{ position:"absolute",bottom:14,left:14,
          fontFamily:"monospace",fontSize:11,color:"#334155",letterSpacing:1 }}>
          {nodeCount} nodes · drag · scroll to zoom
        </div>
      )}
    </div>
  );
}

// ── Pure-canvas physics simulation ───────────────────────────────
function startSim(rawNodes, rawLinks, canvas, ctx, onNodeClick, stRef, setHoveredNode) {
  const nodes = rawNodes.map(n => ({
    ...n,
    x:  canvas.width  * (.15 + Math.random()*.7),
    y:  canvas.height * (.15 + Math.random()*.7),
    vx: (Math.random()-.5)*1.5,
    vy: (Math.random()-.5)*1.5,
    fx: null, fy: null,
  }));
  const idMap = {};
  nodes.forEach((n,i) => { idMap[n.id]=i; });
  const links = rawLinks
    .map(l => ({ ...l, s:idMap[l.source], t:idMap[l.target] }))
    .filter(l => l.s!==undefined && l.t!==undefined);

  let dragIdx=-1, panning=false, lastX=0, lastY=0, hovered=-1;

  const toWorld = (cx,cy) => ({
    x:(cx-stRef.current.tx)/stRef.current.scale,
    y:(cy-stRef.current.ty)/stRef.current.scale,
  });
  const toScreen = (wx,wy) => ({
    x: wx*stRef.current.scale + stRef.current.tx,
    y: wy*stRef.current.scale + stRef.current.ty,
  });

  const hit = (wx,wy) => {
    for (let i=nodes.length-1;i>=0;i--) {
      const n=nodes[i], r=nodeR(n)+3;
      if ((wx-n.x)**2+(wy-n.y)**2 < r*r) return i;
    }
    return -1;
  };

  const onDown = e => {
    const r=canvas.getBoundingClientRect();
    const cx=e.clientX-r.left, cy=e.clientY-r.top;
    const {x:wx,y:wy}=toWorld(cx,cy);
    const h=hit(wx,wy);
    if (h>=0) { dragIdx=h; nodes[h].fx=nodes[h].x; nodes[h].fy=nodes[h].y; }
    else panning=true;
    lastX=cx; lastY=cy;
  };
  const onMove = e => {
    const r=canvas.getBoundingClientRect();
    const cx=e.clientX-r.left, cy=e.clientY-r.top;
    const dx=cx-lastX, dy=cy-lastY;
    lastX=cx; lastY=cy;
    if (dragIdx>=0) {
      const {x:wx,y:wy}=toWorld(cx,cy);
      nodes[dragIdx].x=nodes[dragIdx].fx=wx;
      nodes[dragIdx].y=nodes[dragIdx].fy=wy;
    } else if (panning) {
      stRef.current.tx+=dx;
      stRef.current.ty+=dy;
    }
    // hover
    const {x:wx,y:wy}=toWorld(cx,cy);
    const h=hit(wx,wy);
    if (h!==hovered) {
      hovered=h;
      canvas.style.cursor = h>=0 ? "pointer" : "grab";
      if (h>=0) {
        const {x:sx,y:sy}=toScreen(nodes[h].x,nodes[h].y);
        setHoveredNode({ ...nodes[h], screenX:sx, screenY:sy });
      } else {
        setHoveredNode(null);
      }
    } else if (h>=0) {
      const {x:sx,y:sy}=toScreen(nodes[h].x,nodes[h].y);
      setHoveredNode(prev => prev ? { ...prev, screenX:sx, screenY:sy } : null);
    }
  };
  const onUp = e => {
    if (dragIdx>=0) {
      const r=canvas.getBoundingClientRect();
      const cx=e.clientX-r.left, cy=e.clientY-r.top;
      const {x:wx,y:wy}=toWorld(cx,cy);
      if (Math.hypot(wx-nodes[dragIdx].x,wy-nodes[dragIdx].y)<5 && onNodeClick)
        onNodeClick(rawNodes[dragIdx]);
      nodes[dragIdx].fx=null; nodes[dragIdx].fy=null;
    }
    dragIdx=-1; panning=false;
  };
  const onWheel = e => {
    e.preventDefault();
    const r=canvas.getBoundingClientRect();
    const cx=e.clientX-r.left, cy=e.clientY-r.top;
    const f=e.deltaY<0?1.12:0.89;
    stRef.current.tx=cx-(cx-stRef.current.tx)*f;
    stRef.current.ty=cy-(cy-stRef.current.ty)*f;
    stRef.current.scale=Math.max(0.08,Math.min(8,stRef.current.scale*f));
  };
  canvas.addEventListener("mousedown",onDown);
  canvas.addEventListener("mousemove",onMove);
  canvas.addEventListener("mouseup",  onUp);
  canvas.addEventListener("mouseleave",()=>{panning=false;dragIdx=-1;setHoveredNode(null);});
  canvas.addEventListener("wheel",    onWheel,{passive:false});

  let alpha=1;
  const K=140, KR=280;

  const tick = () => {
    alpha=Math.max(0.01,alpha*.984);
    const a=alpha;
    for (let i=0;i<nodes.length;i++) {
      for (let j=i+1;j<nodes.length;j++) {
        const dx=nodes[j].x-nodes[i].x, dy=nodes[j].y-nodes[i].y;
        const d=Math.max(1,Math.hypot(dx,dy));
        const f=KR/(d*d)*a;
        const fx=dx/d*f, fy=dy/d*f;
        nodes[i].vx-=fx; nodes[i].vy-=fy;
        nodes[j].vx+=fx; nodes[j].vy+=fy;
      }
    }
    links.forEach(l=>{
      const s=nodes[l.s],t=nodes[l.t];
      const dx=t.x-s.x, dy=t.y-s.y;
      const d=Math.max(1,Math.hypot(dx,dy));
      const f=(d-K)/d*.06*a;
      s.vx+=dx*f; s.vy+=dy*f; t.vx-=dx*f; t.vy-=dy*f;
    });
    const cx=canvas.width/2, cy=canvas.height/2;
    nodes.forEach(n=>{
      n.vx+=(cx-n.x)*.003*a; n.vy+=(cy-n.y)*.003*a;
    });
    nodes.forEach(n=>{
      if (n.fx!=null){n.x=n.fx;n.y=n.fy;n.vx=0;n.vy=0;return;}
      n.vx*=.82; n.vy*=.82; n.x+=n.vx; n.y+=n.vy;
    });
  };

  const draw = () => {
    const W=canvas.width, H=canvas.height;
    const {tx,ty,scale}=stRef.current;
    ctx.clearRect(0,0,W,H);
    ctx.save();
    ctx.translate(tx,ty);
    ctx.scale(scale,scale);

    // draw links
    links.forEach(l=>{
      const s=nodes[l.s],t=nodes[l.t];
      const color=LINK_COLOR[l.type]||LINK_COLOR.default;
      ctx.beginPath();
      ctx.moveTo(s.x,s.y);
      ctx.lineTo(t.x,t.y);
      ctx.strokeStyle=color;
      ctx.globalAlpha=.35;
      ctx.lineWidth=Math.max(.5,(l.confidence||.4)*2.5);
      ctx.stroke();
    });
    ctx.globalAlpha=1;

    // draw nodes
    nodes.forEach((n,i)=>{
      const r=nodeR(n);
      const color=LABEL_COLOR[n.label]||LABEL_COLOR.default;
      const isHov=(i===hovered);

      // glow for high severity
      if ((n.severity||0)>0.70 || isHov) {
        ctx.beginPath();
        ctx.arc(n.x,n.y,r+(isHov?10:6),0,Math.PI*2);
        ctx.fillStyle=color;
        ctx.globalAlpha=isHov?.18:.06;
        ctx.fill();
        ctx.globalAlpha=1;
      }

      // severity ring
      if ((n.severity||0)>0.70) {
        ctx.beginPath();
        ctx.arc(n.x,n.y,r+5,0,Math.PI*2);
        ctx.strokeStyle="#EF4444";
        ctx.globalAlpha=.45;
        ctx.lineWidth=1.5;
        ctx.setLineDash([4,2]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // main circle
      ctx.beginPath();
      ctx.arc(n.x,n.y,isHov?r+3:r,0,Math.PI*2);
      ctx.fillStyle=color;
      ctx.globalAlpha=isHov?1:.85;
      ctx.fill();
      // inner highlight
      ctx.beginPath();
      ctx.arc(n.x-r*.25,n.y-r*.25,r*.35,0,Math.PI*2);
      ctx.fillStyle="rgba(255,255,255,.15)";
      ctx.fill();
      ctx.globalAlpha=1;
      // border
      ctx.beginPath();
      ctx.arc(n.x,n.y,isHov?r+3:r,0,Math.PI*2);
      ctx.strokeStyle=isHov?"#fff":color;
      ctx.lineWidth=isHov?2:1;
      ctx.stroke();

      // label — bigger font
      ctx.font=`bold ${n.label==="Nation"?13:11}px monospace`;
      ctx.fillStyle=isHov?"#fff":"#94A3B8";
      ctx.textAlign="center";
      ctx.textBaseline="top";
      ctx.globalAlpha=isHov?1:.9;
      ctx.fillText((n.name||"").slice(0,16),n.x,n.y+r+4);
      ctx.globalAlpha=1;
    });

    ctx.restore();
  };

  const loop=()=>{
    tick(); draw();
    stRef.current.animId=requestAnimationFrame(loop);
  };
  stRef.current.animId=requestAnimationFrame(loop);
}