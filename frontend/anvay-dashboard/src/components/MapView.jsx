// src/components/MapView.jsx
import { useState, useEffect, useRef } from "react";
import { MapContainer, TileLayer, CircleMarker, Marker, Popup } from "react-leaflet";
import L from "leaflet";

// ── Config ─────────────────────────────────────────────────────────
const FIRMS_SOURCE        = "VIIRS_SNPP_NRT";
const FIRMS_DAYS          = 1;
const BBOX                = { lamin: 6, lomin: 60, lamax: 38, lomax: 98 };
const AIRCRAFT_REFRESH_MS = 15_000;
const QUAKE_REFRESH_MS    = 60_000; // USGS updates every minute

// ── FIRMS helpers ──────────────────────────────────────────────────
function frpToSeverity(frp) { return Math.min(1, parseFloat(frp || 0) / 300); }
function frpColor(sev) {
  if (sev > 0.75) return "#FF2D2D";
  if (sev > 0.45) return "#FF8C00";
  if (sev > 0.20) return "#FFD700";
  return "#ADFF2F";
}
async function fetchFIRMS() {
  const res = await fetch("http://localhost:8000/api/firms");
  if (!res.ok) throw new Error(`FIRMS ${res.status}`);
  const text    = await res.text();
  const lines   = text.trim().split("\n");
  const headers = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const vals = line.split(",");
    const row  = Object.fromEntries(headers.map((h, i) => [h.trim(), vals[i]?.trim()]));
    const sev  = frpToSeverity(row.frp);
    return {
      lat: parseFloat(row.latitude), lng: parseFloat(row.longitude),
      sev, color: frpColor(sev),
      frp:    parseFloat(row.frp || 0).toFixed(1),
      bright: row.bright_ti4 || row.brightness || "—",
      conf:   row.confidence || "—",
      date:   row.acq_date   || "—",
      time:   row.acq_time   || "—",
      sat:    row.satellite  || FIRMS_SOURCE,
    };
  })
  .filter((e) => !isNaN(e.lat) && !isNaN(e.lng))
  .sort((a, b) => b.sev - a.sev)
  .slice(0, 3000);
}

// ── Aircraft helpers ───────────────────────────────────────────────
const F = { icao:0, callsign:1, origin:2, lon:5, lat:6, alt:7, onGround:8, velocity:9, heading:10 };

function planeIcon(heading) {
  return L.divIcon({
    className: "",
    html: `<div style="transform:rotate(${heading ?? 0}deg);width:20px;height:20px;
      display:flex;align-items:center;justify-content:center;">
      <svg viewBox="0 0 24 24" width="16" height="16" xmlns="http://www.w3.org/2000/svg">
        <path fill="#00d4ff" stroke="#001a22" stroke-width="1"
          d="M12 2l2.4 6.5H22l-6.2 4.5 2.4 7L12 16.2 5.8 20l2.4-7L2 8.5h7.6z"/>
      </svg></div>`,
    iconSize: [20, 20], iconAnchor: [10, 10],
  });
}

async function fetchAircraft() {
  const res = await fetch(
    `https://opensky-network.org/api/states/all`
  );
  if (!res.ok) throw new Error(`OpenSky ${res.status}`);
  const json = await res.json();
  // Return a maximum of 1500 flights globally to prevent freezing the DOM
  return (json.states || [])
    .filter((s) => !s[F.onGround] && s[F.lat] && s[F.lon])
    .slice(0, 1500) // Hardware acceleration safety limit
    .map((s) => ({
      icao:     s[F.icao]?.trim()     || "—",
      callsign: s[F.callsign]?.trim() || "N/A",
      origin:   s[F.origin]           || "—",
      lat:      s[F.lat],  lng: s[F.lon],
      alt:      s[F.alt]      ? `${(s[F.alt]      / 0.3048 / 1000).toFixed(1)} kft` : "—",
      vel:      s[F.velocity] ? `${(s[F.velocity] * 1.944).toFixed(0)} kts`         : "—",
      heading:  s[F.heading] ?? 0,
    }));
}


// ── Seismic helpers ────────────────────────────────────────────────
// USGS GeoJSON feed — all quakes M2.5+ in the last 24 h (no key needed)
const USGS_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson";

function magToColor(mag) {
  if (mag >= 6.0) return "#FF2D2D"; // major
  if (mag >= 5.0) return "#FF6B35"; // strong
  if (mag >= 4.0) return "#FFD700"; // moderate
  if (mag >= 3.0) return "#C084FC"; // minor
  return "#6B7280";                  // micro
}
function magToRadius(mag) {
  return Math.max(4, mag * 3.5);    // scale with magnitude
}

async function fetchQuakes() {
  const res = await fetch(USGS_URL);
  if (!res.ok) throw new Error(`USGS ${res.status}`);
  const json = await res.json();
  return (json.features || []).map((f) => ({
    id:    f.id,
    lat:   f.geometry.coordinates[1],
    lng:   f.geometry.coordinates[0],
    depth: f.geometry.coordinates[2]?.toFixed(1) ?? "—",
    mag:   f.properties.mag,
    place: f.properties.place || "Unknown",
    time:  new Date(f.properties.time).toUTCString(),
    url:   f.properties.url,
    color: magToColor(f.properties.mag),
    radius: magToRadius(f.properties.mag),
  })).filter((e) => !isNaN(e.lat) && !isNaN(e.lng));
}

// ── Shared UI — layer toggle button ───────────────────────────────
function LayerBtn({ active, color, icon, label, count, loading, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 7,
      background: active ? `${color}18` : "rgba(3,5,8,0.6)",
      border: `1px solid ${active ? color : "rgba(255,255,255,0.08)"}`,
      borderRadius: 4, padding: "5px 10px", cursor: "pointer",
      fontFamily: "monospace", fontSize: 10,
      color: active ? color : "#555",
      transition: "all 0.15s", whiteSpace: "nowrap",
    }}>
      <span>{loading ? "⟳" : icon}</span>
      <span style={{ textTransform: "uppercase", letterSpacing: 1 }}>{label}</span>
      {count !== null && !loading && (
        <span style={{
          background: active ? color : "#222",
          color: active ? "#000" : "#444",
          borderRadius: 3, padding: "1px 5px", fontSize: 9, fontWeight: 700,
        }}>
          {count.toLocaleString()}
        </span>
      )}
    </button>
  );
}

// ── Main component ─────────────────────────────────────────────────
export default function MapView() {
  const [layers,   setLayers]   = useState({ fires: true, aircraft: true, quakes: true });
  const [fires,    setFires]    = useState([]);
  const [aircraft, setAircraft] = useState([]);
  const [quakes,   setQuakes]   = useState([]);

  const [status, setStatus] = useState({
    fires:    { loading: false, error: null, lastSync: null },
    aircraft: { loading: false, error: null, lastSync: null },
    quakes:   { loading: false, error: null, lastSync: null },
  });

  const acTimer = useRef(null);
  const qkTimer = useRef(null);

  const patch = (layer, obj) =>
    setStatus((s) => ({ ...s, [layer]: { ...s[layer], ...obj } }));

  // ── Load fires (once) ──
  useEffect(() => {
    patch("fires", { loading: true });
    fetchFIRMS()
      .then((d) => { setFires(d); patch("fires", { loading: false, error: null, lastSync: new Date().toLocaleTimeString() }); })
      .catch((e) => patch("fires", { loading: false, error: e.message }));
  }, []);

  // ── Load aircraft (auto-refresh 15 s) ──
  const loadAircraft = async () => {
    patch("aircraft", { loading: true });
    try {
      const d = await fetchAircraft();
      setAircraft(d);
      patch("aircraft", { loading: false, error: null, lastSync: new Date().toLocaleTimeString() });
    } catch (e) { patch("aircraft", { loading: false, error: e.message }); }
  };
  useEffect(() => {
    loadAircraft();
    acTimer.current = setInterval(loadAircraft, AIRCRAFT_REFRESH_MS);
    return () => clearInterval(acTimer.current);
  }, []);

  // ── Load quakes (auto-refresh 60 s) ──
  const loadQuakes = async () => {
    patch("quakes", { loading: true });
    try {
      const d = await fetchQuakes();
      setQuakes(d);
      patch("quakes", { loading: false, error: null, lastSync: new Date().toLocaleTimeString() });
    } catch (e) { patch("quakes", { loading: false, error: e.message }); }
  };
  useEffect(() => {
    loadQuakes();
    qkTimer.current = setInterval(loadQuakes, QUAKE_REFRESH_MS);
    return () => clearInterval(qkTimer.current);
  }, []);

  const toggle = (key) => setLayers((l) => ({ ...l, [key]: !l[key] }));

  return (
    <div style={{ height: "100%", width: "100%", position: "relative" }}>

      {/* ── Layer toggles (top-left) ── */}
      <div style={{
        position: "absolute", top: 8, left: 8, zIndex: 1000,
        display: "flex", flexDirection: "column", gap: 5,
      }}>
        <LayerBtn active={layers.fires}    color="#FF8C00" icon="🔥" label="FIRMS Fires"
          count={fires.length}    loading={status.fires.loading}    onClick={() => toggle("fires")} />
        <LayerBtn active={layers.aircraft} color="#00d4ff" icon="✈"  label="Aircraft"
          count={aircraft.length} loading={status.aircraft.loading} onClick={() => toggle("aircraft")} />
        <LayerBtn active={layers.quakes}   color="#C084FC" icon="〰" label="Seismic M2.5+"
          count={quakes.length}   loading={status.quakes.loading}   onClick={() => toggle("quakes")} />

        {/* Sync row */}
        <div style={{
          fontFamily: "monospace", fontSize: 9, color: "#444",
          paddingLeft: 2, display: "flex", flexDirection: "column", gap: 2, marginTop: 2,
        }}>
          {status.fires.lastSync    && <span style={{ color: layers.fires    ? "#FF8C00" : "#333" }}>🔥 {status.fires.lastSync}</span>}
          {status.aircraft.lastSync && <span style={{ color: layers.aircraft ? "#00d4ff" : "#333" }}>✈ {status.aircraft.lastSync} · ↻15s</span>}
          {status.quakes.lastSync   && <span style={{ color: layers.quakes   ? "#C084FC" : "#333" }}>〰 {status.quakes.lastSync} · ↻60s</span>}
        </div>

        {/* Error banners */}
        {["fires","aircraft","quakes"].map((k) => status[k].error && (
          <div key={k} style={{
            background: "#EF444418", border: "1px solid #EF4444",
            color: "#EF4444", borderRadius: 4,
            fontFamily: "monospace", fontSize: 10, padding: "4px 8px",
          }}>
            ⚠ {k}: {status[k].error}
          </div>
        ))}
      </div>

      {/* ── Initial load overlay ── */}
      {status.fires.loading && fires.length === 0 && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 2000,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(3,5,8,0.75)", color: "#FF8C00",
          fontFamily: "monospace", fontSize: 13, letterSpacing: 1,
        }}>
          🔥 Fetching NASA FIRMS fire data…
        </div>
      )}

      <MapContainer center={[20, 78]} zoom={4}
        style={{ height: "100%", width: "100%" }}
        zoomControl preferCanvas={true}>
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://carto.com">CARTO</a>'
        />

        {/* ── Fire markers ── */}
        {layers.fires && fires.map((ev, i) => (
          <CircleMarker key={`fire-${i}`} center={[ev.lat, ev.lng]}
            radius={4 + ev.sev * 12}
            pathOptions={{ color: ev.color, fillColor: ev.color, fillOpacity: 0.55, weight: 1 }}>
            <Popup>
              <div style={{ fontFamily: "monospace", fontSize: 11, minWidth: 180 }}>
                <div style={{ fontWeight: 700, marginBottom: 6, color: ev.color }}>🔥 Active Fire Detection</div>
                <div>Lat / Lng: <strong>{ev.lat.toFixed(3)}, {ev.lng.toFixed(3)}</strong></div>
                <div>FRP: <strong>{ev.frp} MW</strong></div>
                <div>Brightness: <strong>{ev.bright} K</strong></div>
                <div>Confidence: <strong>{ev.conf}</strong></div>
                <div>Acquired: <strong>{ev.date} {ev.time}</strong></div>
                <div style={{ color: "#777", marginTop: 4, fontSize: 10 }}>Satellite: {ev.sat}</div>
              </div>
            </Popup>
          </CircleMarker>
        ))}

        {/* ── Aircraft markers ── */}
        {layers.aircraft && aircraft.map((ac, i) => (
          <Marker key={`ac-${i}`} position={[ac.lat, ac.lng]} icon={planeIcon(ac.heading)}>
            <Popup>
              <div style={{ fontFamily: "monospace", fontSize: 11, minWidth: 180 }}>
                <div style={{ fontWeight: 700, marginBottom: 6, color: "#00d4ff" }}>✈ {ac.callsign}</div>
                <div>ICAO: <strong>{ac.icao}</strong></div>
                <div>Origin: <strong>{ac.origin}</strong></div>
                <div>Altitude: <strong>{ac.alt}</strong></div>
                <div>Speed: <strong>{ac.vel}</strong></div>
                <div>Heading: <strong>{ac.heading}°</strong></div>
              </div>
            </Popup>
          </Marker>
        ))}

        {/* ── Seismic markers ── */}
        {layers.quakes && quakes.map((q) => (
          <CircleMarker key={q.id} center={[q.lat, q.lng]}
            radius={q.radius}
            pathOptions={{
              color: q.color, fillColor: q.color,
              fillOpacity: 0.35, weight: 1.5,
            }}>
            <Popup>
              <div style={{ fontFamily: "monospace", fontSize: 11, minWidth: 200 }}>
                <div style={{ fontWeight: 700, marginBottom: 6, color: q.color }}>
                  〰 M{q.mag?.toFixed(1)} Earthquake
                </div>
                <div>Location: <strong>{q.place}</strong></div>
                <div>Depth: <strong>{q.depth} km</strong></div>
                <div>Time: <strong>{q.time}</strong></div>
                <div style={{ marginTop: 6 }}>
                  <a href={q.url} target="_blank" rel="noreferrer"
                    style={{ color: q.color, fontSize: 10 }}>
                    → USGS event page
                  </a>
                </div>
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>

      {/* ── Legend (bottom-right) ── */}
      <div style={{
        position: "absolute", bottom: 24, right: 8, zIndex: 1000,
        background: "rgba(3,5,8,0.9)", border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 4, padding: "8px 12px",
        display: "flex", flexDirection: "column", gap: 10,
      }}>

        {/* Fire legend */}
        {layers.fires && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontFamily: "monospace", fontSize: 9, color: "#FF8C00",
              textTransform: "uppercase", letterSpacing: 1 }}>Fire Intensity (FRP)</div>
            {[["#FF2D2D","> 225 MW","Extreme"],["#FF8C00","90–225 MW","High"],
              ["#FFD700","30–90 MW","Moderate"],["#ADFF2F","< 30 MW","Low"]].map(([c,r,l]) => (
              <div key={l} style={{ display:"flex", alignItems:"center", gap:6,
                fontSize:9, fontFamily:"monospace", color:c }}>
                <div style={{ width:8, height:8, borderRadius:"50%", background:c, opacity:0.85 }} />
                <span>{l}</span><span style={{ color:"#444", marginLeft:2 }}>{r}</span>
              </div>
            ))}
          </div>
        )}

        {/* Seismic legend */}
        {layers.quakes && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontFamily: "monospace", fontSize: 9, color: "#C084FC",
              textTransform: "uppercase", letterSpacing: 1 }}>Magnitude</div>
            {[["#FF2D2D","≥ 6.0","Major"],["#FF6B35","5.0–5.9","Strong"],
              ["#FFD700","4.0–4.9","Moderate"],["#C084FC","3.0–3.9","Minor"],
              ["#6B7280","< 3.0","Micro"]].map(([c,r,l]) => (
              <div key={l} style={{ display:"flex", alignItems:"center", gap:6,
                fontSize:9, fontFamily:"monospace", color:c }}>
                <div style={{ width:8, height:8, borderRadius:"50%", background:c, opacity:0.85 }} />
                <span>{l}</span><span style={{ color:"#444", marginLeft:2 }}>{r}</span>
              </div>
            ))}
          </div>
        )}

        {/* Aircraft legend */}
        {layers.aircraft && (
          <div style={{ display:"flex", alignItems:"center", gap:6,
            fontFamily:"monospace", fontSize:9, color:"#00d4ff" }}>
            <svg viewBox="0 0 24 24" width="10" height="10">
              <path fill="#00d4ff" d="M12 2l2.4 6.5H22l-6.2 4.5 2.4 7L12 16.2 5.8 20l2.4-7L2 8.5h7.6z"/>
            </svg>
            <span style={{ textTransform:"uppercase", letterSpacing:1 }}>Aircraft (OpenSky)</span>
          </div>
        )}
      </div>
    </div>
  );
}