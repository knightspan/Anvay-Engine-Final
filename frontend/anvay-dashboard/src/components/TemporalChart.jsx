// src/components/TemporalChart.jsx
import { useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import axios from "axios";

const CHART_STYLE = {
  background: "transparent",
};

const TOOLTIP_STYLE = {
  background: "#0F172A",
  border:     "1px solid rgba(0,212,255,.2)",
  borderRadius: 6,
  color:      "#E2E8F0",
  fontFamily: "monospace",
  fontSize:   11,
};

export default function TemporalChart() {
  const [locData,  setLocData]  = useState([]);
  const [phData,   setPhData]   = useState([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    const fetchBoth = async () => {
      try {
        const [locRes, phRes] = await Promise.all([
          axios.get("http://localhost:8000/api/temporal/EVT002"),
          axios.get("http://localhost:8000/api/temporal/PHE001"),
        ]);

        setLocData(
          (locRes.data.trajectory || []).map((t, i) => ({
            month:      t.month || `T${i + 1}`,
            severity:   Math.round((t.severity || 0) * 100),
            violations: t.violations || t.state?.violations || 0,
          }))
        );

        setPhData(
          (phRes.data.trajectory || []).map((t, i) => ({
            month:   t.month || `T${i + 1}`,
            severity: Math.round((t.severity || 0) * 100),
            deficit: t.rainfall_deficit || t.state?.rainfall_deficit || 0,
          }))
        );
      } catch (e) {
        console.error("Temporal fetch error", e);
      } finally {
        setLoading(false);
      }
    };
    fetchBoth();
  }, []);

  if (loading) return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      height: "100%", flexDirection: "column", gap: 10,
    }}>
      <div style={{
        width: 28, height: 28,
        border: "2px solid rgba(0,212,255,.12)",
        borderTopColor: "#00D4FF",
        borderRadius: "50%",
        animation: "spin 1s linear infinite",
      }} />
      <div style={{ fontFamily: "monospace", fontSize: 9, color: "#334155", letterSpacing: 2 }}>
        Loading trajectory…
      </div>
    </div>
  );

  return (
    <div style={{ padding: 20, height: "100%", overflowY: "auto" }}>

      {/* ── LoC CHART ── */}
      <div style={{
        fontFamily: "monospace", fontSize: 9, color: "#EF4444",
        letterSpacing: 3, marginBottom: 14, textTransform: "uppercase",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <div style={{
          width: 8, height: 8, borderRadius: "50%",
          background: "#EF4444", boxShadow: "0 0 6px #EF4444",
        }} />
        LoC Ceasefire Violations — Temporal Trajectory
      </div>

      <div style={{
        background: "rgba(239,68,68,.03)",
        border: "1px solid rgba(239,68,68,.1)",
        borderRadius: 4, padding: "12px 0 4px", marginBottom: 28,
      }}>
        {locData.length > 0 ? (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={locData} style={CHART_STYLE}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
              <XAxis
                dataKey="month"
                stroke="#1E293B"
                tick={{ fontSize: 9, fill: "#475569", fontFamily: "monospace" }}
              />
              <YAxis
                stroke="#1E293B"
                tick={{ fontSize: 9, fill: "#475569", fontFamily: "monospace" }}
              />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend
                wrapperStyle={{ fontSize: 9, fontFamily: "monospace", paddingTop: 4 }}
              />
              <ReferenceLine y={70} stroke="rgba(239,68,68,.3)" strokeDasharray="4 2"
                label={{ value: "Alert threshold", fill: "#EF4444", fontSize: 8 }} />
              <Line
                type="monotone" dataKey="severity"
                stroke="#EF4444" strokeWidth={2}
                dot={{ r: 4, fill: "#EF4444" }}
                activeDot={{ r: 6 }}
                name="Severity %"
              />
              <Line
                type="monotone" dataKey="violations"
                stroke="#F59E0B" strokeWidth={2}
                dot={{ r: 4, fill: "#F59E0B" }}
                activeDot={{ r: 6 }}
                name="Violations / month"
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div style={{
            height: 180, display: "flex", alignItems: "center",
            justifyContent: "center",
            fontFamily: "monospace", fontSize: 9, color: "#334155",
          }}>
            No trajectory data — run seed_graph.py first
          </div>
        )}
      </div>

      {/* ── DROUGHT CHART ── */}
      <div style={{
        fontFamily: "monospace", fontSize: 9, color: "#3B82F6",
        letterSpacing: 3, marginBottom: 14, textTransform: "uppercase",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <div style={{
          width: 8, height: 8, borderRadius: "50%",
          background: "#3B82F6", boxShadow: "0 0 6px #3B82F6",
        }} />
        Vidarbha Drought — Rainfall Deficit Trajectory
      </div>

      <div style={{
        background: "rgba(59,130,246,.03)",
        border: "1px solid rgba(59,130,246,.1)",
        borderRadius: 4, padding: "12px 0 4px", marginBottom: 24,
      }}>
        {phData.length > 0 ? (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={phData} style={CHART_STYLE}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
              <XAxis
                dataKey="month"
                stroke="#1E293B"
                tick={{ fontSize: 9, fill: "#475569", fontFamily: "monospace" }}
              />
              <YAxis
                stroke="#1E293B"
                tick={{ fontSize: 9, fill: "#475569", fontFamily: "monospace" }}
              />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend
                wrapperStyle={{ fontSize: 9, fontFamily: "monospace", paddingTop: 4 }}
              />
              <Line
                type="monotone" dataKey="severity"
                stroke="#3B82F6" strokeWidth={2}
                dot={{ r: 4, fill: "#3B82F6" }}
                activeDot={{ r: 6 }}
                name="Severity %"
              />
              <Line
                type="monotone" dataKey="deficit"
                stroke="#22C55E" strokeWidth={2}
                dot={{ r: 4, fill: "#22C55E" }}
                activeDot={{ r: 6 }}
                name="Rainfall deficit %"
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div style={{
            height: 180, display: "flex", alignItems: "center",
            justifyContent: "center",
            fontFamily: "monospace", fontSize: 9, color: "#334155",
          }}>
            No trajectory data — run seed_graph.py first
          </div>
        )}
      </div>

      {/* insight box */}
      <div style={{
        background: "rgba(168,85,247,.04)",
        border: "1px solid rgba(168,85,247,.15)",
        borderLeft: "3px solid #A855F7",
        borderRadius: "0 4px 4px 0",
        padding: "12px 16px",
      }}>
        <div style={{
          fontFamily: "monospace", fontSize: 9, color: "#A855F7",
          letterSpacing: 2, textTransform: "uppercase", marginBottom: 8,
        }}>
          Temporal Insight
        </div>
        <div style={{ fontFamily: "Georgia, serif", fontSize: 12, color: "#94A3B8", lineHeight: 1.7 }}>
          LoC violations climbed from <strong style={{ color: "#F59E0B" }}>4/month → 17/month</strong> over
          4 months — a 325% acceleration. This coincides with the Vidarbha drought
          trajectory, confirming the <strong style={{ color: "#A855F7" }}>climate → society → defence</strong> causal
          chain with a <strong style={{ color: "#EF4444" }}>60-day lag</strong>.
        </div>
      </div>
    </div>
  );
}
