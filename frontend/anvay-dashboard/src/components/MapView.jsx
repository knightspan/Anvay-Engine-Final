// src/components/MapView.jsx
import { MapContainer, TileLayer, CircleMarker, Tooltip, Popup } from "react-leaflet";


const EVENTS = [
  {
    lat: 33.7,  lng: 76.3,
    name: "LAC Tension Zone — Eastern Ladakh",
    domain: "defence", sev: 0.82,
    detail: "PLA exercise + India LAC standoff 2026"
  },
  {
    lat: 20.5,  lng: 78.9,
    name: "Vidarbha Drought 2026",
    domain: "climate", sev: 0.68,
    detail: "14 districts, rabi crop -23%"
  },
  {
    lat: 24.8,  lng: 62.0,
    name: "CPEC Phase III — Gwadar",
    domain: "geopolitics", sev: 0.75,
    detail: "$15 billion infrastructure investment"
  },
  {
    lat: 28.6,  lng: 77.2,
    name: "Food Price Protests — Delhi",
    domain: "society", sev: 0.61,
    detail: "Civil unrest over wheat inflation"
  },
  {
    lat: 32.5,  lng: 74.5,
    name: "LoC Ceasefire Violations",
    domain: "defence", sev: 0.82,
    detail: "17 incidents in Feb 2026"
  },
  {
    lat: 30.7,  lng: 79.0,
    name: "Depsang LAC Standoff",
    domain: "defence", sev: 0.77,
    detail: "India-China military face-off"
  },
  {
    lat: 18.5,  lng: 73.8,
    name: "Maharashtra Food Protests",
    domain: "society", sev: 0.71,
    detail: "6 border districts — police deployed"
  },
  {
    lat: 22.6,  lng: 88.4,
    name: "Bangladesh-India Border Watch",
    domain: "geopolitics", sev: 0.45,
    detail: "Political transition monitoring"
  },
  {
    lat: 13.0,  lng: 77.6,
    name: "DRDO Facility — Bengaluru",
    domain: "defence", sev: 0.40,
    detail: "Defence R&D and procurement hub"
  },
];

const D_COLOR = {
  geopolitics: "#F5911E",
  defence:     "#EF4444",
  economics:   "#22C55E",
  climate:     "#3B82F6",
  society:     "#A855F7",
  default:     "#64748B",
};

export default function MapView() {
  return (
    <div style={{ height: "100%", width: "100%", position: "relative" }}>
      <MapContainer
        center={[25, 74]}
        zoom={4}
        style={{ height: "100%", width: "100%" }}
        zoomControl={true}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://carto.com">CARTO</a>'
        />

        {EVENTS.map((ev, i) => {
          const color = D_COLOR[ev.domain] || D_COLOR.default;
          return (
            <CircleMarker
              key={i}
              center={[ev.lat, ev.lng]}
              radius={8 + ev.sev * 16}
              pathOptions={{
                color:       color,
                fillColor:   color,
                fillOpacity: 0.50,
                weight:      2,
              }}
            >
              <Tooltip permanent direction="top">
                <span style={{ fontFamily: "monospace", fontSize: 10 }}>
                  {ev.name}
                </span>
              </Tooltip>
              <Popup>
                <div style={{ fontFamily: "monospace", fontSize: 11, minWidth: 180 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4, color: "#1a1a1a" }}>
                    {ev.name}
                  </div>
                  <div style={{ color: "#555", marginBottom: 2 }}>
                    Domain: <strong>{ev.domain}</strong>
                  </div>
                  <div style={{ color: "#555", marginBottom: 2 }}>
                    Severity: <strong>{(ev.sev * 100).toFixed(0)}%</strong>
                  </div>
                  <div style={{ color: "#777", fontSize: 10, marginTop: 6 }}>
                    {ev.detail}
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>

      {/* domain legend */}
      <div style={{
        position: "absolute", top: 8, right: 8, zIndex: 1000,
        background: "rgba(3,5,8,0.9)",
        border: "1px solid rgba(0,212,255,0.15)",
        borderRadius: 4, padding: "8px 12px",
        display: "flex", flexDirection: "column", gap: 5,
      }}>
        {Object.entries(D_COLOR).filter(([k]) => k !== "default").map(([domain, color]) => (
          <div key={domain} style={{
            display: "flex", alignItems: "center", gap: 6,
            fontSize: 9, fontFamily: "monospace", color,
            textTransform: "uppercase", letterSpacing: 1,
          }}>
            <div style={{
              width: 8, height: 8, borderRadius: "50%",
              background: color, opacity: 0.8,
            }} />
            {domain}
          </div>
        ))}
      </div>
    </div>
  );
}
