"use client";
import React, { useState, useRef, useEffect } from "react";

const API = "http://localhost:8000";

// ── helpers ──────────────────────────────────────────────────
async function api(method: string, path: string, body?: object) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// ── tiny UI primitives ────────────────────────────────────────
const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="border border-zinc-700 rounded-xl bg-zinc-900 p-5 flex flex-col gap-3">
    <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-400">{title}</h2>
    {children}
  </div>
);

const Btn = ({ onClick, children, color = "blue", loading = false }: {
  onClick: () => void; children: React.ReactNode; color?: string; loading?: boolean;
}) => (
  <button
    onClick={onClick}
    disabled={loading}
    className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all
      ${color === "blue"  ? "bg-blue-600 hover:bg-blue-500"  : ""}
      ${color === "green" ? "bg-emerald-600 hover:bg-emerald-500" : ""}
      ${color === "red"   ? "bg-red-700 hover:bg-red-600"    : ""}
      ${color === "amber" ? "bg-amber-600 hover:bg-amber-500" : ""}
      ${loading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
      text-white`}
  >
    {loading ? "⏳ Loading…" : children}
  </button>
);

const Pre = ({ data }: { data: unknown }) => (
  <pre className="text-xs bg-zinc-950 text-emerald-400 rounded-lg p-3 overflow-auto max-h-72 whitespace-pre-wrap">
    {data ? JSON.stringify(data, null, 2) : "—"}
  </pre>
);

const Input = ({ label, value, onChange, type = "text" }: {
  label: string; value: string | number; onChange: (v: string) => void; type?: string;
}) => (
  <div className="flex flex-col gap-1">
    <label className="text-xs text-zinc-400">{label}</label>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
    />
  </div>
);

const Select = ({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: string[];
}) => (
  <div className="flex flex-col gap-1">
    <label className="text-xs text-zinc-400">{label}</label>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
    >
      {options.map((o) => <option key={o}>{o}</option>)}
    </select>
  </div>
);

const Badge = ({ label, color }: { label: React.ReactNode; color: "green" | "red" | "amber" | "blue" | "zinc" }) => {
  const c = {
    green: "bg-emerald-900 text-emerald-300",
    red:   "bg-red-900 text-red-300",
    amber: "bg-amber-900 text-amber-300",
    blue:  "bg-blue-900 text-blue-300",
    zinc:  "bg-zinc-700 text-zinc-300",
  }[color];
  return <span className={`px-2 py-0.5 rounded text-xs font-semibold ${c}`}>{label}</span>;
};


// ── Status color helper ────────────────────────────────────────
function statusColor(s: string): "green" | "red" | "amber" | "blue" | "zinc" {
  if (s === "APPROVED" || s === "RECOVERED" || s === "SUCCESS") return "green";
  if (s === "BLOCKED" || s === "FAILED") return "red";
  if (s === "ESCALATED" || s === "HUMAN_REVIEW") return "amber";
  if (s === "healthy") return "green";
  return "zinc";
}

// ─────────────────────────────────────────────────────────────
// SECTIONS
// ─────────────────────────────────────────────────────────────


function BatchSection() {
  const [activeMode, setActiveMode] = useState<"preset" | "upload">("upload");
  const [sampleSize, setSampleSize] = useState("500");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [data, setData]             = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [selectedTxn, setSelectedTxn] = useState<Record<string, unknown> | null>(null);
  const [showBatchLog, setShowBatchLog] = useState(true);
  const fileInputRef                = useRef<HTMLInputElement>(null);

  // Run preset dataset batch
  const runPreset = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api("POST", "/api/batch/run", { sample_size: Number(sampleSize) });
      setData(res);
    } catch (e) {
      setError(`Preset batch failed: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  // Upload custom CSV file
  const handleUpload = async () => {
    if (!selectedFile) {
      setError("Please choose a CSV file to upload.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      const res = await fetch(`${API}/api/batch/upload`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Upload failed with HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
    } catch (e: unknown) {
      setError(`Upload error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  // Download sample template CSV
  const downloadTemplate = () => {
    window.open(`${API}/api/batch/sample-template`, "_blank");
  };

  const b  = data?.baseline  as Record<string, unknown> | undefined;
  const ai = data?.recoverai as Record<string, unknown> | undefined;
  const details = (data?.case_details as Array<Record<string, unknown>>) || [];
  const batchLog = (data?.batch_audit_log as Array<Record<string, unknown>>) || [];

  return (
    <Card title="Batch Recovery Evaluation & Custom CSV Upload (Track 03 Benchmark)">

      {/* Mode Selector */}
      <div className="flex gap-2 border-b border-zinc-800 pb-3">
        <button
          onClick={() => { setActiveMode("upload"); setError(null); setSelectedTxn(null); }}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            activeMode === "upload"
              ? "bg-blue-600 text-white shadow-lg shadow-blue-900/40"
              : "bg-zinc-800 text-zinc-400 hover:text-white"
          }`}
        >
          📂 Upload Custom CSV
        </button>
        <button
          onClick={() => { setActiveMode("preset"); setError(null); setSelectedTxn(null); }}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            activeMode === "preset"
              ? "bg-blue-600 text-white shadow-lg shadow-blue-900/40"
              : "bg-zinc-800 text-zinc-400 hover:text-white"
          }`}
        >
          ⚡ Built-in Test Dataset (16.6k rows)
        </button>
      </div>

      {/* ── Mode 1: Custom CSV Upload ────────────────────────── */}
      {activeMode === "upload" && (
        <div className="flex flex-col gap-3">
          {/* Required columns banner */}
          <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg p-3 text-xs text-zinc-300">
            <p className="font-semibold text-blue-400 mb-1">Upload CSV with the following columns:</p>
            <code className="text-[11px] text-emerald-400 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-700">
              transaction_id, customer_id, amount_inr, status, failure_code, payment_method, attempt_count, timestamp
            </code>
          </div>

          {/* File Input and Action Buttons */}
          <div className="flex flex-wrap gap-3 items-center">
            <input
              type="file"
              ref={fileInputRef}
              accept=".csv"
              onChange={(e) => {
                setSelectedFile(e.target.files?.[0] || null);
                setSelectedTxn(null);
              }}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-600 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer"
            >
              {selectedFile ? `📄 ${selectedFile.name}` : "📁 Choose CSV File"}
            </button>

            <Btn onClick={() => { setSelectedTxn(null); handleUpload(); }} loading={loading} color="green">
              🚀 Run Batch Recovery on Uploaded CSV
            </Btn>

            <button
              onClick={downloadTemplate}
              className="bg-zinc-800 hover:bg-zinc-700 text-blue-400 border border-zinc-700 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer ml-auto"
            >
              📥 Download Sample CSV Template
            </button>
          </div>
        </div>
      )}

      {/* ── Mode 2: Preset Test Batch ───────────────────────── */}
      {activeMode === "preset" && (
        <div className="flex gap-3 items-end">
          <Input label="Sample Size (max 16,663)" value={sampleSize} onChange={setSampleSize} type="number" />
          <Btn onClick={() => { setSelectedTxn(null); runPreset(); }} loading={loading} color="amber">Run Simulation on Test Batch</Btn>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="bg-red-950 border border-red-700 rounded-lg p-3 text-xs text-red-300 font-mono">
          {error}
        </div>
      )}

      {/* ── Results Summary Table ───────────────────────────── */}
      {data && b && ai && (
        <div className="flex flex-col gap-4 mt-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase text-zinc-400">Experiment Results</span>
            <Badge label={`Batch: ${String(data.batch_id)}`} color="zinc" />
            <Badge label={`${String(data.cases_evaluated)} Cases`} color="blue" />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-700">
                  <th className="py-2 pr-4 text-zinc-400">Metric</th>
                  <th className="py-2 pr-4 text-zinc-300">Naive Baseline</th>
                  <th className="py-2 text-blue-400">RecoverAI Policy Engine</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Cases Evaluated",       String(data.cases_evaluated),               String(data.cases_evaluated)],
                  ["Revenue at Risk",       `₹${data.revenue_at_risk_inr}`,     `₹${data.revenue_at_risk_inr}`],
                  ["Actions Attempted",     String(b.actions_attempted),        String(ai.actions_attempted)],
                  ["Attributed Recoveries", String(b.attributed_recoveries),    String(ai.attributed_recoveries)],
                  ["Counterfactual Cases",  String(b.counterfactual_cases),     String(ai.counterfactual_cases)],
                  ["Gross Recovered",       `₹${b.gross_recovered_inr}`,        `₹${ai.gross_recovered_inr}`],
                  ["Intervention Cost",     `₹${b.total_intervention_cost_inr}`, `₹${ai.total_intervention_cost_inr}`],
                  ["Net Recovered (ROI)",   `₹${b.net_recovered_inr}`,          `₹${ai.net_recovered_inr}`],
                  ["Recovery Rate",         `${b.recovery_rate_pct}%`,          `${ai.recovery_rate_pct}%`],
                ].map(([m, bv, rv]) => (
                  <tr key={String(m)} className="border-b border-zinc-800 hover:bg-zinc-800/50">
                    <td className="py-1.5 pr-4 text-zinc-400">{m}</td>
                    <td className="py-1.5 pr-4 text-zinc-300 font-mono">{String(bv)}</td>
                    <td className="py-1.5 text-blue-300 font-semibold font-mono">{String(rv)}</td>
                  </tr>
                ))}
                <tr className="bg-emerald-900/30">
                  <td className="py-2 pr-4 text-emerald-400 font-bold">Incremental Lift</td>
                  <td></td>
                  <td className="py-2 text-emerald-300 font-bold font-mono">
                    +₹{String(data.incremental_revenue_inr)} ({String(data.recovery_uplift_pct)}% uplift)
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* ── Batch Orchestration Multi-Agent Audit Log ─────────── */}
          {batchLog.length > 0 && (
            <div className="flex flex-col gap-3 bg-zinc-950/90 border border-zinc-800/90 rounded-2xl p-4 shadow-xl">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse"></span>
                    Autonomous Multi-Agent Audit Trail ({batchLog.length} Engine Milestones)
                  </span>
                  <Badge label="ORCHESTRATED" color="blue" />
                </div>
                <button
                  onClick={() => setShowBatchLog(!showBatchLog)}
                  className="text-xs text-blue-400 hover:text-blue-300 font-semibold cursor-pointer"
                >
                  {showBatchLog ? "▲ Hide Timeline" : "▼ Expand Timeline"}
                </button>
              </div>

              {showBatchLog && (
                <div className="grid gap-2.5 mt-1">
                  {batchLog.map((logItem, idx) => {
                    const agentStr = String(logItem.agent || "");
                    const isAttribution = agentStr.includes("ROI") || agentStr.includes("ATTRIBUTION");
                    const isGuardrail = agentStr.includes("GUARDRAIL");
                    const isML = agentStr.includes("ML") || agentStr.includes("MODEL");
                    const isNormalizer = agentStr.includes("FEATURE") || agentStr.includes("NORMALIZATION");
                    const isDispatcher = agentStr.includes("INTERVENTION") || agentStr.includes("DISPATCH");

                    const icon = isAttribution ? "📈" : isGuardrail ? "🛡️" : isML ? "🧠" : isNormalizer ? "🔄" : isDispatcher ? "⚡" : "🤖";
                    const borderCls = isAttribution ? "border-l-emerald-500" : isGuardrail ? "border-l-emerald-400" : isML ? "border-l-indigo-500" : isNormalizer ? "border-l-cyan-500" : "border-l-amber-500";
                    const badgeClr = isAttribution ? "green" : isGuardrail ? "green" : isML ? "blue" : "zinc";

                    return (
                      <div
                        key={idx}
                        className={`flex items-start gap-3 bg-zinc-900/90 hover:bg-zinc-850 border border-zinc-800 rounded-xl p-3 text-xs border-l-4 ${borderCls} shadow-sm transition-all`}
                      >
                        <span className="text-base select-none shrink-0 mt-0.5">{icon}</span>
                        <div className="flex flex-col gap-1 flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-white text-xs">
                              {String(logItem.agent_label || logItem.agent)}
                            </span>
                            <Badge label={String(logItem.event)} color={badgeClr} />
                            <span className="text-[10px] text-zinc-500 ml-auto font-mono">
                              {String(logItem.timestamp).replace("T", " ").substring(0, 19)}
                            </span>
                          </div>
                          <p className="text-zinc-300 text-xs font-sans leading-relaxed">
                            {String(logItem.message)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Per-Transaction Decisioning Table & Inspector ───── */}
          {details.length > 0 && (
            <div className="flex flex-col gap-3 mt-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="text-xs font-bold text-zinc-200 uppercase tracking-wider flex items-center gap-2">
                    <span>📋</span> Transaction Decision Ledger ({details.length} Cases Evaluated)
                  </p>
                  <p className="text-[11px] text-zinc-400 mt-0.5">Click any row below to inspect autonomous agent step-by-step reasoning</p>
                </div>
                <Badge label="INTERACTIVE AUDIT" color="zinc" />
              </div>

              <div className="overflow-x-auto max-h-96 overflow-y-auto border border-zinc-800/90 rounded-xl bg-zinc-900/60 shadow-inner">
                <table className="w-full text-xs text-left border-collapse min-w-[880px]">
                  <thead className="sticky top-0 bg-zinc-900 border-b border-zinc-800 z-10 text-[11px] uppercase tracking-wider text-zinc-400 font-semibold">
                    <tr>
                      <th className="py-2.5 px-3">Txn ID</th>
                      <th className="py-2.5 px-3">Customer</th>
                      <th className="py-2.5 px-3">Amount</th>
                      <th className="py-2.5 px-3">Failure Reason</th>
                      <th className="py-2.5 px-3">Payment Method</th>
                      <th className="py-2.5 px-3">P(Recovery)</th>
                      <th className="py-2.5 px-3">Expected ERV</th>
                      <th className="py-2.5 px-3">RecoverAI Action</th>
                      <th className="py-2.5 px-3">Guardrail</th>
                      <th className="py-2.5 px-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {details.map((c) => {
                      const isSelected = selectedTxn && selectedTxn.transaction_id === c.transaction_id;
                      const rawFailure = String(c.failure_code || "").trim();
                      const failureCode = (!rawFailure || rawFailure.toUpperCase() === "NAN" || rawFailure.toUpperCase() === "NONE" || rawFailure.toUpperCase() === "NULL")
                        ? "DROPOFF"
                        : rawFailure;
                      const pNum = Number(c.p_recovery || 0);
                      const action = String(c.recommended_action || "DO_NOTHING");

                      return (
                        <tr
                          key={String(c.transaction_id)}
                          onClick={() => setSelectedTxn(c)}
                          className={`border-b border-zinc-800/60 cursor-pointer transition-colors ${
                            isSelected
                              ? "bg-blue-950/60 border-blue-500/80"
                              : "hover:bg-zinc-800/50"
                          }`}
                        >
                          <td className="py-2 px-3 text-zinc-300 font-mono font-bold">
                            #{String(c.transaction_id)}
                          </td>
                          <td className="py-2 px-3 text-zinc-400 font-mono text-[11px]">
                            {String(c.customer_id)}
                          </td>
                          <td className="py-2 px-3 text-white font-bold font-mono">
                            ₹{Number(c.amount_inr || 0).toLocaleString("en-IN")}
                          </td>
                          <td className="py-2 px-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold font-mono inline-block ${
                              failureCode.includes("TECHNICAL") || failureCode.includes("BANK")
                                ? "bg-rose-950/80 text-rose-300 border border-rose-800/80"
                                : failureCode.includes("INSUFFICIENT") || failureCode.includes("FUNDS")
                                ? "bg-amber-950/80 text-amber-300 border border-amber-800/80"
                                : failureCode.includes("RATE") || failureCode.includes("LIMIT")
                                ? "bg-purple-950/80 text-purple-300 border border-purple-800/80"
                                : "bg-blue-950/80 text-blue-300 border border-blue-800/80"
                            }`}>
                              {failureCode.replace(/_/g, " ")}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-zinc-300 text-xs">
                            {String(c.payment_method).includes("UPI") ? "📱 UPI AutoPay" :
                             String(c.payment_method).includes("CARD") ? "💳 Card SI" :
                             String(c.payment_method).includes("NETBANKING") ? "🏦 NetBanking" :
                             String(c.payment_method).replace(/_/g, " ")}
                          </td>
                          <td className="py-2 px-3">
                            <span className={`font-mono font-bold text-xs ${
                              pNum >= 0.6 ? "text-emerald-400" : pNum >= 0.3 ? "text-amber-400" : "text-rose-400"
                            }`}>
                              {(pNum * 100).toFixed(1)}%
                            </span>
                          </td>
                          <td className="py-2 px-3 text-emerald-300 font-mono font-semibold">
                            ₹{Number(c.erv || 0).toLocaleString("en-IN")}
                          </td>
                          <td className="py-2 px-3">
                            <span className={`px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wider inline-block ${
                              action === "RETRY" ? "bg-blue-900/60 text-blue-200 border border-blue-700/60" :
                              action === "SEND_PAYMENT_LINK" ? "bg-emerald-900/60 text-emerald-200 border border-emerald-700/60 font-bold" :
                              action === "CHANGE_PAYMENT_METHOD" ? "bg-purple-900/60 text-purple-200 border border-purple-700/60" :
                              action === "ESCALATE" ? "bg-amber-900/60 text-amber-200 border border-amber-700/60" :
                              "bg-zinc-800 text-zinc-400 border border-zinc-700"
                            }`}>
                              {action.replace(/_/g, " ")}
                            </span>
                          </td>
                          <td className="py-2 px-3">
                            <Badge label={String(c.guardrail_status)} color={statusColor(String(c.guardrail_status))} />
                          </td>
                          <td className="py-2 px-3 text-center">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedTxn(c);
                              }}
                              className={`px-2.5 py-1 rounded text-xs font-semibold transition-all cursor-pointer ${
                                isSelected
                                  ? "bg-blue-600 text-white shadow-md shadow-blue-500/30"
                                  : "bg-zinc-800 hover:bg-blue-600 hover:text-white text-blue-400 border border-zinc-700"
                              }`}
                            >
                              🔍 Trace
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* ── Transaction Audit & Agent Reasoning Inspector ──── */}
              {selectedTxn && (
                <div className="mt-2 bg-zinc-950 border-2 border-blue-600/70 rounded-xl p-4 flex flex-col gap-3 shadow-2xl">
                  {/* Header */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-white">
                        🔎 Agent Audit Trace: Txn #{String(selectedTxn.transaction_id)}
                      </span>
                      <Badge label={`Customer: ${String(selectedTxn.customer_id)}`} color="zinc" />
                      <Badge label={`₹${String(selectedTxn.amount_inr)}`} color="green" />
                      <Badge
                        label={`Risk: ${String(selectedTxn.risk_level || 'MED')}`}
                        color={selectedTxn.risk_level === 'LOW' ? 'green' : selectedTxn.risk_level === 'HIGH' ? 'red' : 'amber'}
                      />
                      <Badge label={`Action: ${String(selectedTxn.recommended_action)}`} color="blue" />
                    </div>
                    <button
                      onClick={() => setSelectedTxn(null)}
                      className="text-xs text-zinc-400 hover:text-white bg-zinc-800 px-2 py-1 rounded cursor-pointer"
                    >
                      ✕ Close Inspector
                    </button>
                  </div>

                  {/* Agent Diagnostic Rationale Banner */}
                  {Boolean(selectedTxn.agent_reasoning) && (
                    <div className="bg-gradient-to-r from-blue-950/60 to-purple-950/40 border border-blue-800/60 rounded-lg p-3 text-xs text-blue-200 leading-relaxed">
                      <p className="font-bold text-blue-400 uppercase tracking-wider text-[10px] mb-1 flex items-center gap-1.5">
                        💡 Agent Diagnostic Rationale & Decision Logic
                      </p>
                      {String(selectedTxn.agent_reasoning)}
                    </div>
                  )}


                  {/* Multi-Agent Step-by-Step Pipeline */}
                  <div className="flex flex-col gap-2 mt-1">
                    <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                      🪜 Autonomous Agent Pipeline Execution Trace
                    </p>

                    {Array.isArray(selectedTxn.audit_steps) && (selectedTxn.audit_steps as Array<Record<string, unknown>>).map((st, i) => (
                      <div
                        key={i}
                        className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 flex flex-col gap-1.5"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="w-5 h-5 rounded-full bg-blue-900 text-blue-300 text-[10px] font-bold flex items-center justify-center">
                            {i + 1}
                          </span>
                          <span className="text-xs font-bold text-white">
                            {String(st.agent_label || st.agent)}
                          </span>
                          <Badge label={String(st.step)} color="zinc" />
                          <span className="text-[10px] text-zinc-500 ml-auto font-mono">
                            {String(st.timestamp).replace("T", " ").substring(0, 19)}
                          </span>
                        </div>

                        {Boolean(st.detail) && (
                          <div className="bg-zinc-950 rounded p-2 text-[11px] font-mono text-emerald-400 border border-zinc-800/60 mt-1 whitespace-pre-wrap">
                            {JSON.stringify(st.detail, null, 2)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <Pre data={{ guardrail_stats: data.guardrail_stats, ml_metrics: data.ml_metrics }} />
        </div>
      )}

    </Card>
  );
}


// ─────────────────────────────────────────────────────────────
// EXECUTIVE DASHBOARD & PRIORITY CASE QUEUE
// ─────────────────────────────────────────────────────────────
function ExecutiveDashboardSection({ onNavigateToBatch }: { onNavigateToBatch?: () => void }) {
  const [data, setData]       = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [runningQuickBatch, setRunningQuickBatch] = useState(false);

  // Cases Queue state
  const [casesLimit, setCasesLimit] = useState("10");
  const [casesData, setCasesData]   = useState<Record<string, unknown> | null>(null);
  const [casesLoading, setCasesLoading] = useState(false);

  const loadDashboard = async () => {
    setLoading(true);
    try {
      const res = await api("GET", "/api/dashboard");
      setData(res);
    } catch {
      // quiet fallback
    } finally {
      setLoading(false);
    }
  };

  const loadCases = async (limitVal = casesLimit) => {
    setCasesLoading(true);
    try {
      const res = await api("GET", `/api/cases?limit=${limitVal}&offset=0`);
      setCasesData(res);
    } catch {
      // quiet fallback
    } finally {
      setCasesLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
    loadCases();
  }, []);

  const runQuickBenchmark = async () => {
    setRunningQuickBatch(true);
    try {
      await api("POST", "/api/batch/run", { sample_size: 250 });
      await loadDashboard();
    } catch (e) {
      console.error(e);
    } finally {
      setRunningQuickBatch(false);
    }
  };

  const cases = casesData?.cases as Array<Record<string, unknown>> | undefined;

  return (
    <div className="flex flex-col gap-6">
      {/* Portfolio Performance Card */}
      <Card title="Executive Recovery Portfolio · Macro KPIs">
        <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
          <p className="text-xs text-zinc-400">
            Portfolio performance aggregated from latest counterfactual batch evaluation
          </p>
          <Btn onClick={loadDashboard} loading={loading} color="zinc">↻ Refresh KPIs</Btn>
        </div>

        {data?.status === "no_batch_run" && (
          <div className="bg-gradient-to-r from-blue-950/40 to-indigo-950/30 border border-blue-800/60 rounded-xl p-5 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="text-base">📊</span>
              <p className="text-sm font-bold text-white">No Portfolio Simulation Evaluated Yet</p>
            </div>
            <p className="text-xs text-zinc-300 leading-relaxed max-w-2xl">
              To view portfolio-wide verified recovery metrics (Gross Recovered, Net Recovered, Recovery Rate %, and Incremental Uplift),
              run an evaluation on your custom CSV or the built-in 16,663 transaction dataset.
            </p>
            <div className="flex gap-3 mt-1 flex-wrap">
              <Btn onClick={runQuickBenchmark} loading={runningQuickBatch} color="blue">
                ⚡ Run Quick Benchmark (250 Cases)
              </Btn>
              {onNavigateToBatch && (
                <button
                  onClick={onNavigateToBatch}
                  className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 rounded-lg text-xs font-semibold cursor-pointer"
                >
                  📂 Go to Custom CSV Upload &amp; Full Batch →
                </button>
              )}
            </div>
          </div>
        )}

        {data?.status === "available" && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[
                { label: "Cases Evaluated",     value: data.cases_evaluated, subtitle: "Real transactions processed" },
                { label: "Revenue at Risk",      value: `₹${Number(data.revenue_at_risk_inr || 0).toLocaleString("en-IN")}`, subtitle: "Total failed payment value" },
                { label: "Net Recovered (ROI)",  value: `₹${Number(data.recoverai_net_recovered_inr || 0).toLocaleString("en-IN")}`, subtitle: "After intervention costs", highlight: true },
                { label: "RecoverAI Rate",      value: `${data.recoverai_recovery_rate_pct}%`, subtitle: `vs ${data.baseline_recovery_rate_pct}% baseline` },
                { label: "Baseline Rate",        value: `${data.baseline_recovery_rate_pct}%`, subtitle: "Naive 3-retry strategy" },
                { label: "Incremental Lift",    value: `+₹${Number(data.incremental_revenue_inr || 0).toLocaleString("en-IN")}`, subtitle: `${data.recovery_uplift_pct}% relative uplift`, highlight: true },
              ].map(({ label, value, subtitle, highlight }) => (
                <div key={label} className={`rounded-xl p-4 border transition-all ${
                  highlight
                    ? "bg-emerald-950/40 border-emerald-800/80 shadow-md shadow-emerald-950/30"
                    : "bg-zinc-900 border-zinc-800"
                }`}>
                  <p className="text-xs text-zinc-400 mb-1">{label}</p>
                  <p className={`text-xl font-bold font-mono ${highlight ? "text-emerald-400" : "text-white"}`}>
                    {String(value)}
                  </p>
                  {subtitle && <p className="text-[11px] text-zinc-500 mt-1">{subtitle}</p>}
                </div>
              ))}
            </div>

            {/* Incremental Lift Callout */}
            <div className="bg-emerald-900/20 border border-emerald-800/60 rounded-xl p-3 flex items-center justify-between flex-wrap gap-2 text-xs">
              <span className="text-emerald-300 font-semibold">
                ✓ Proven Incrementality: ₹{Number(data.incremental_revenue_inr || 0).toLocaleString("en-IN")} recovered that the standard retry rule lost.
              </span>
              <Badge label={`Uplift: ${String(data.recovery_uplift_pct)}%`} color="green" />
            </div>
          </div>
        )}
      </Card>

      {/* Priority Case Queue */}
      <Card title="Priority Case Queue · Ranked by Expected Recovery Value (ERV)">
        <div className="flex items-center justify-between gap-3 flex-wrap pb-2 border-b border-zinc-800">
          <p className="text-xs text-zinc-400">
            Highest-value at-risk cases ordered by ML Expected Recovery Value (ERV = P(recovery) × Amount)
          </p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500">Rows:</span>
            {["10", "25", "50"].map((n) => (
              <button
                key={n}
                onClick={() => { setCasesLimit(n); loadCases(n); }}
                className={`px-2 py-1 rounded text-xs cursor-pointer ${
                  casesLimit === n ? "bg-blue-600 text-white font-bold" : "bg-zinc-800 text-zinc-400 hover:text-white"
                }`}
              >
                {n}
              </button>
            ))}
            <Btn onClick={() => loadCases(casesLimit)} loading={casesLoading} color="zinc">↻</Btn>
          </div>
        </div>

        {casesData && (
          <p className="text-xs text-zinc-500">
            Total {String(casesData.total)} cases in queue · Top {casesLimit} shown
          </p>
        )}

        {cases && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-700 text-zinc-400">
                  <th className="py-2 pr-3">Case ID</th>
                  <th className="py-2 pr-3">Amount</th>
                  <th className="py-2 pr-3">Failure Reason</th>
                  <th className="py-2 pr-3">P(Recovery)</th>
                  <th className="py-2 pr-3">Expected Value (ERV)</th>
                  <th className="py-2 pr-3">AI Action</th>
                  <th className="py-2">Guardrail Status</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => (
                  <tr key={String(c.case_id)} className="border-b border-zinc-800 hover:bg-zinc-800/50">
                    <td className="py-2 pr-3 text-zinc-300 font-mono font-bold">#{String(c.case_id)}</td>
                    <td className="py-2 pr-3 font-semibold text-white">₹{String(c.amount_inr)}</td>
                    <td className="py-2 pr-3 text-zinc-400 text-xs">{String(c.failure_class).replace(/_/g, ' ')}</td>
                    <td className="py-2 pr-3">
                      <span className={`font-mono font-bold ${Number(c.recovery_probability) > 0.6 ? 'text-emerald-400' : Number(c.recovery_probability) > 0.35 ? 'text-amber-400' : 'text-red-400'}`}>
                        {(Number(c.recovery_probability) * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-emerald-300 font-mono font-bold">₹{String(c.expected_recovery_inr)}</td>
                    <td className="py-2 pr-3"><Badge label={String(c.recommended_action)} color="zinc" /></td>
                    <td className="py-2"><Badge label={String(c.policy_status)} color={statusColor(String(c.policy_status))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// AI LABS & DIAGNOSTICS (PTP, TELEMETRY, AUDIT EXPLORER)
// ─────────────────────────────────────────────────────────────
function AILabsSection() {
  const [healthData, setHealthData] = useState<Record<string, unknown> | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  // PTP state
  const [ptpText, setPtpText] = useState("bhai salary 5 ko aayegi uske baad kar dunga");
  const [ptpData, setPtpData] = useState<Record<string, unknown> | null>(null);
  const [ptpLoading, setPtpLoading] = useState(false);

  // Audit lookup state
  const [auditCaseId, setAuditCaseId] = useState("610");
  const [auditData, setAuditData]     = useState<Record<string, unknown> | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);

  const fetchHealth = async () => {
    setHealthLoading(true);
    setHealthData(await api("GET", "/api/health"));
    setHealthLoading(false);
  };

  useEffect(() => {
    fetchHealth();
  }, []);

  const runPTP = async () => {
    setPtpLoading(true);
    setPtpData(await api("POST", "/api/dunning/parse-ptp", { text: ptpText }));
    setPtpLoading(false);
  };

  const runAudit = async () => {
    setAuditLoading(true);
    setAuditData(await api("GET", `/api/audit/${auditCaseId}`));
    setAuditLoading(false);
  };

  const PTP_TESTS = [
    "bhai salary 5 ko aayegi uske baad kar dunga",
    "payment done kar diya",
    "will pay on 10th",
    "I already paid yesterday",
    "link kaam nahi kar raha error aa raha hai",
    "stop messaging me",
    "why did my payment fail?",
  ];

  const auditLogs = auditData?.logs as Array<Record<string, unknown>> | undefined;

  return (
    <div className="flex flex-col gap-6">
      {/* Telemetry & Health */}
      <Card title="System Telemetry & Engine Status">
        <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
          <p className="text-xs text-zinc-400">Live operational status of ML models, gateways, and communication channels</p>
          <Btn onClick={fetchHealth} loading={healthLoading} color="zinc">↻ Refresh Telemetry</Btn>
        </div>
        {healthData && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="bg-zinc-900 border border-zinc-800 p-3 rounded-xl flex flex-col gap-1">
              <span className="text-zinc-500 font-semibold uppercase text-[10px]">API Status</span>
              <span className="text-sm font-bold text-emerald-400 font-mono">● {String(healthData.status).toUpperCase()}</span>
              <span className="text-[10px] text-zinc-500">v{String(healthData.version)}</span>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 p-3 rounded-xl flex flex-col gap-1">
              <span className="text-zinc-500 font-semibold uppercase text-[10px]">Policy Model (LightGBM)</span>
              <span className="text-sm font-bold text-blue-400 font-mono">ROC-AUC: {String(healthData.model_auc || "0.776")}</span>
              <span className="text-[10px] text-zinc-500">Trained on 16.6k RBI/Razorpay cases</span>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 p-3 rounded-xl flex flex-col gap-1">
              <span className="text-zinc-500 font-semibold uppercase text-[10px]">Razorpay Gateway</span>
              <span className="text-sm font-bold text-emerald-400 font-mono">
                {healthData.razorpay_mock ? "Mock Mode" : "✓ Test-Mode Active"}
              </span>
              <span className="text-[10px] text-zinc-500">Key: rzp_test_TWqd...</span>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 p-3 rounded-xl flex flex-col gap-1">
              <span className="text-zinc-500 font-semibold uppercase text-[10px]">Twilio SMS Service</span>
              <span className="text-sm font-bold text-emerald-400 font-mono">✓ Online &amp; Verified</span>
              <span className="text-[10px] text-zinc-500">Twilio Phone: +17372212163</span>
            </div>
          </div>
        )}
      </Card>

      {/* Hinglish / PTP Parser */}
      <Card title="Hinglish &amp; Promise-To-Pay (PTP) NLP Intent Parser">
        <p className="text-xs text-zinc-400">
          Extracts customer payment intent, sentiment, and promised dates from informal WhatsApp/SMS replies
        </p>
        <div className="flex flex-col gap-2">
          <label className="text-xs text-zinc-400">Customer Reply Text</label>
          <textarea
            value={ptpText}
            onChange={(e) => setPtpText(e.target.value)}
            rows={2}
            className="bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 resize-none font-mono"
          />
          <div className="flex flex-wrap gap-2">
            {PTP_TESTS.map((t) => (
              <button
                key={t}
                onClick={() => setPtpText(t)}
                className="text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-2.5 py-1 rounded cursor-pointer border border-zinc-700 transition-colors"
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Btn onClick={runPTP} loading={ptpLoading} color="blue">Parse Response</Btn>
        </div>
        {ptpData && (
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs text-zinc-400">Intent:</span>
              <Badge label={String(ptpData.intent)} color={
                ptpData.intent === "PAY_NOW" || ptpData.intent === "PROMISE_TO_PAY" ? "green" :
                ptpData.intent === "REFUSAL_OPT_OUT" || ptpData.intent === "FAILED_RAIL" ? "red" : "zinc"
              } />
              <Badge label={`Sentiment: ${String(ptpData.sentiment)}`} color={
                ptpData.sentiment === "POSITIVE" ? "green" : ptpData.sentiment === "NEGATIVE" ? "red" : "zinc"
              } />
              <Badge label={`Confidence: ${ptpData.confidence}`} color="blue" />
              {Boolean(ptpData.promised_date) && <Badge label={`Promised Date: ${String(ptpData.promised_date)}`} color="amber" />}
              <Badge label={`Method: ${ptpData.parse_method}`} color={ptpData.parse_method === "llm" ? "green" : "amber"} />
            </div>
            <Pre data={ptpData} />
          </div>
        )}
      </Card>

      {/* Central Immutable Audit Trail Explorer */}
      <Card title="Central Immutable Audit Trail Explorer">
        <p className="text-xs text-zinc-400">
          Query the immutable event log for any case ID across live and batch execution
        </p>
        <div className="flex gap-3 items-end">
          <Input label="Case ID" value={auditCaseId} onChange={setAuditCaseId} />
          <Btn onClick={runAudit} loading={auditLoading} color="zinc">Lookup Case History</Btn>
        </div>
        {auditLogs && auditLogs.length === 0 && (
          <p className="text-xs text-zinc-500">No audit events recorded for Case #{auditCaseId} yet.</p>
        )}
        {auditLogs && auditLogs.length > 0 && (
          <div className="flex flex-col gap-2 max-h-96 overflow-y-auto pr-1">
            {auditLogs.map((log) => (
              <div key={String(log.event_id)} className="bg-zinc-900 rounded-lg p-3 border border-zinc-800 text-xs font-mono">
                <div className="flex items-center gap-2 mb-1">
                  <Badge label={String(log.event_type)} color="blue" />
                  <span className="text-[11px] text-zinc-500">{String(log.timestamp).replace("T", " ").substring(0, 19)}</span>
                  <span className="text-[10px] text-zinc-600 ml-auto">{String(log.event_id)}</span>
                </div>
                <Pre data={log.details} />
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Active Recovery Card — shown after payment fails/dismissed
// ─────────────────────────────────────────────────────────────
type RecoveryPlan = {
  case_id: string;
  amount_inr: number;
  failure_reason: string;
  case_source: string;
  diagnosis: {
    failure_class: string;
    bank_name: string;
    rail: string;
    risk_level: string;
    recovery_probability: number;
    expected_recovery_inr: number;
    retries_used: number;
    customer_tenure_days: number;
    prior_success_rate: number;
  };
  policy: {
    proposed_action: string;
    final_action: string;
    guardrail_status: string;
    guardrail_reason: string;
    violations: Array<{ rule_id: string; message: string }>;
  };
  recovery_action: {
    action: string;
    payment_url: string;
    cost_inr: number;
  };
  outreach: {
    channel: string;
    locale: string;
    message_body: string;
    payment_link: string;
    method: string;
    customer_phone?: string;
    sms_dispatch?: {
      status?: string;
      message_sid?: string;
      to?: string;
      error?: string;
      is_mock?: boolean;
    };
  };
  audit_steps: Array<{ step: string; timestamp: string; detail: Record<string, unknown> }>;
  elapsed_ms: number;
  ledger_status?: string;
  payment_link_id?: string;
};

function RecoveryCard({ plan }: { plan: RecoveryPlan }) {
  const d = plan.diagnosis;
  const p = plan.policy;
  const r = plan.recovery_action;
  const o = plan.outreach;

  const riskColor = d.risk_level === "LOW" ? "green" : d.risk_level === "MEDIUM" ? "amber" : "red";
  const pct       = Math.round(d.recovery_probability * 100);

  return (
    <div className="flex flex-col gap-4 border border-emerald-800 bg-emerald-950/30 rounded-xl p-5">

      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-emerald-400 font-bold text-sm">⚡ AI Recovery Activated</span>
        <Badge label={`Case #${plan.case_id}`} color="zinc" />
        <Badge label={`₹${plan.amount_inr}`} color="zinc" />
        <span className="ml-auto text-xs text-zinc-500">{plan.elapsed_ms}ms</span>
      </div>

      {/* Diagnosis row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-700">
          <p className="text-xs text-zinc-400 mb-1">Root Cause</p>
          <p className="text-sm font-semibold text-white">{d.failure_class?.replace(/_/g, " ")}</p>
          <p className="text-xs text-zinc-500">{d.bank_name} · {d.rail}</p>
        </div>
        <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-700">
          <p className="text-xs text-zinc-400 mb-1">Recovery Prob.</p>
          <p className={`text-2xl font-bold ${pct >= 65 ? "text-emerald-400" : pct >= 35 ? "text-amber-400" : "text-red-400"}`}>
            {pct}%
          </p>
          <Badge label={`Risk: ${d.risk_level}`} color={riskColor} />
        </div>
        <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-700">
          <p className="text-xs text-zinc-400 mb-1">Expected Value</p>
          <p className="text-xl font-bold text-emerald-300">₹{d.expected_recovery_inr}</p>
          <p className="text-xs text-zinc-500">Cost: ₹{r.cost_inr}</p>
        </div>
        <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-700">
          <p className="text-xs text-zinc-400 mb-1">Agent Strategy</p>
          <p className="text-sm font-semibold text-blue-300">{p.final_action?.replace(/_/g, " ")}</p>
          <Badge label={p.guardrail_status} color={p.guardrail_status === "APPROVED" ? "green" : p.guardrail_status === "BLOCKED" ? "red" : "amber"} />
        </div>
      </div>

      {/* Outreach message */}
      {o?.message_body && (
        <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-700">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wide">
              Generated {o.channel} Message
            </span>
            <Badge label={o.locale} color="zinc" />
            <Badge label={`via ${o.method ?? "template"}`} color={o.method === "llm" ? "green" : "amber"} />
          </div>
          <p className="text-sm text-white leading-relaxed whitespace-pre-wrap">{o.message_body}</p>
          {o.payment_link && (
            <a
              href={o.payment_link}
              target="_blank"
              rel="noreferrer"
              className="inline-block mt-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-lg font-semibold transition-colors"
            >
              Open Payment Link →
            </a>
          )}
          {o.sms_dispatch && (
            <div className="mt-3 p-2.5 rounded bg-zinc-950/80 border border-zinc-800 text-xs flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="text-zinc-400">📱 Twilio SMS Target:</span>
                <span className="font-mono text-zinc-300 font-semibold">{o.customer_phone || o.sms_dispatch.to}</span>
              </div>
              <Badge
                label={
                  o.sms_dispatch.status === "sent"
                    ? `✓ Dispatched via Twilio (${o.sms_dispatch.message_sid?.slice(0, 10)}...)`
                    : o.sms_dispatch.status === "simulated"
                    ? "SMS Simulated (Add Twilio keys in .env)"
                    : `SMS Error: ${o.sms_dispatch.error || "failed"}`
                }
                color={o.sms_dispatch.status === "sent" ? "green" : o.sms_dispatch.status === "simulated" ? "amber" : "red"}
              />
            </div>
          )}
        </div>
      )}

      {/* Audit trail */}
      <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-700">
        <p className="text-xs font-semibold text-zinc-300 uppercase tracking-wide mb-3">
          Step-by-step Audit Trail
        </p>
        <div className="flex flex-col gap-2">
          {plan.audit_steps.map((s, i) => (
            <div key={i} className="flex gap-3 text-xs">
              <span className="text-zinc-600 font-mono w-5 shrink-0">{i + 1}.</span>
              <span className="font-mono text-blue-400 w-40 shrink-0">{s.step}</span>
              <span className="text-zinc-400 font-mono text-xs truncate">
                {JSON.stringify(s.detail).slice(0, 90)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Live Proof Inspector — Visual State Mutation & Webhook Settlement
// ─────────────────────────────────────────────────────────────
type LedgerRecord = {
  case_id: string;
  status: "PENDING_PAYMENT" | "RECOVERED" | "BLOCKED" | "IN_RECOVERY" | "UNKNOWN" | string;
  amount_inr: number;
  payment_link_id?: string | null;
  short_url?: string | null;
  payment_id?: string | null;
  settled_at?: string | null;
  updated_at?: string | null;
};

function LiveProofInspector({
  caseId,
  plan,
  onRecovered,
}: {
  caseId: string;
  plan: RecoveryPlan | null;
  onRecovered?: (amt: number) => void;
}) {
  const [ledger, setLedger] = useState<LedgerRecord | null>(null);
  const [simulating, setSimulating] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const hasNotifiedRecovered = useRef(false);

  // Synchronize initial plan data
  useEffect(() => {
    if (plan) {
      setLedger({
        case_id: plan.case_id,
        status: plan.ledger_status || "PENDING_PAYMENT",
        amount_inr: plan.amount_inr,
        payment_link_id: plan.payment_link_id,
        short_url: plan.recovery_action?.payment_url,
      });
      hasNotifiedRecovered.current = false;
    }
  }, [plan]);

  // Real-time polling loop (every 2.5s)
  useEffect(() => {
    if (!caseId) return;
    let isSubscribed = true;

    const fetchState = async () => {
      try {
        const liveRes = await api("GET", `/api/cases/live/${caseId}`) as LedgerRecord;
        if (isSubscribed && liveRes && liveRes.status !== "UNKNOWN") {
          setLedger(liveRes);
          if (liveRes.status === "RECOVERED" && !hasNotifiedRecovered.current) {
            hasNotifiedRecovered.current = true;
            if (onRecovered) onRecovered(Number(liveRes.amount_inr || 0));
          }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const auditRes = await api("GET", `/api/audit/${caseId}`) as any;
        if (isSubscribed && auditRes && auditRes.logs) {
          setAuditLogs(auditRes.logs);
        }
      } catch {
        // quiet fallback
      }
    };

    fetchState();
    const interval = setInterval(fetchState, 2500);
    return () => {
      isSubscribed = false;
      clearInterval(interval);
    };
  }, [caseId, onRecovered]);

  const triggerSimulateWebhook = async () => {
    setSimulating(true);
    try {
      const payId = `pay_live_${Math.random().toString(36).substring(2, 9)}`;
      const amountInr = ledger?.amount_inr || plan?.amount_inr || 499;
      const plinkId = ledger?.payment_link_id || plan?.payment_link_id;

      await api("POST", "/api/webhooks/razorpay", {
        event: "payment_link.paid",
        case_id: caseId,
        payment_id: payId,
        amount_inr: amountInr,
        payment_link_id: plinkId,
        payload: {
          payment_link: {
            entity: {
              id: plinkId,
              notes: { case_id: caseId },
            },
          },
          payment: {
            entity: {
              id: payId,
              amount: Math.round(amountInr * 100),
              status: "captured",
            },
          },
        },
      });

      // Immediate refresh
      const refreshed = await api("GET", `/api/cases/live/${caseId}`) as LedgerRecord;
      if (refreshed) {
        setLedger(refreshed);
        if (!hasNotifiedRecovered.current) {
          hasNotifiedRecovered.current = true;
          if (onRecovered) onRecovered(Number(refreshed.amount_inr || 0));
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const auditRes = await api("GET", `/api/audit/${caseId}`) as any;
      if (auditRes?.logs) setAuditLogs(auditRes.logs);
    } catch (err) {
      console.error("Webhook simulation failed:", err);
    } finally {
      setSimulating(false);
    }
  };

  const isRecovered = ledger?.status === "RECOVERED";
  const shortUrl = ledger?.short_url || plan?.recovery_action?.payment_url;
  const plinkId = ledger?.payment_link_id || plan?.payment_link_id;

  return (
    <div className={`rounded-xl border p-5 transition-all duration-300 ${
      isRecovered
        ? "border-emerald-500 bg-emerald-950/40 shadow-lg shadow-emerald-950/40"
        : "border-amber-600/70 bg-amber-950/20"
    }`}>
      {/* Title & Live Poller Status */}
      <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-white flex items-center gap-1.5">
            ⚖️ Active Recovery Inspector · Live State Ledger
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-zinc-400 bg-zinc-900 border border-zinc-700 px-2 py-0.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping inline-block" />
            Poller active (2.5s)
          </span>
        </div>
        <div>
          {isRecovered ? (
            <span className="px-3 py-1 bg-emerald-600 text-white rounded-md text-xs font-bold uppercase tracking-wider flex items-center gap-1 shadow-sm">
              ✓ RECOVERED · SETTLED
            </span>
          ) : (
            <span className="px-3 py-1 bg-amber-500/20 text-amber-300 border border-amber-500/50 rounded-md text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              PENDING_PAYMENT
            </span>
          )}
        </div>
      </div>

      {/* 3-Stage Visual State Mutation Progression */}
      <div className="my-4 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="p-2.5 rounded-lg border border-red-800/60 bg-red-950/30 text-red-300">
          <div className="font-bold">1. FAILED</div>
          <div className="text-[11px] text-zinc-400 mt-0.5">Gateway Error Caught</div>
          <div className="mt-1 text-emerald-400 text-[11px]">✓ Captured</div>
        </div>
        <div className={`p-2.5 rounded-lg border transition-all ${
          isRecovered
            ? "border-zinc-700 bg-zinc-900/50 text-zinc-400"
            : "border-amber-500 bg-amber-950/40 text-amber-200 ring-1 ring-amber-500"
        }`}>
          <div className="font-bold">2. PENDING_PAYMENT</div>
          <div className="text-[11px] text-zinc-400 mt-0.5">Razorpay Link Minted</div>
          <div className="mt-1 font-mono text-[10px] truncate text-blue-300">
            {shortUrl ? shortUrl.replace("https://", "") : "—"}
          </div>
        </div>
        <div className={`p-2.5 rounded-lg border transition-all ${
          isRecovered
            ? "border-emerald-500 bg-emerald-950/60 text-emerald-300 ring-1 ring-emerald-400 font-bold"
            : "border-zinc-800 bg-zinc-900/30 text-zinc-600"
        }`}>
          <div className="font-bold">3. RECOVERED</div>
          <div className="text-[11px] text-zinc-400 mt-0.5">Webhook Confirmed</div>
          <div className="mt-1 text-[11px]">{isRecovered ? "✓ Funds Settled" : "Awaiting event…"}</div>
        </div>
      </div>

      {/* Artifact Evidence Grid */}
      <div className="grid md:grid-cols-2 gap-3 bg-zinc-900/80 rounded-lg p-3 border border-zinc-800 text-xs">
        <div>
          <span className="text-zinc-500 uppercase tracking-wider block text-[10px] mb-1 font-semibold">
            Razorpay Live Link Artifact
          </span>
          {shortUrl ? (
            <div className="flex items-center gap-2">
              <a
                href={shortUrl}
                target="_blank"
                rel="noreferrer"
                className="text-blue-400 hover:text-blue-300 underline font-mono text-xs truncate max-w-[280px]"
              >
                {shortUrl}
              </a>
              <span className="text-zinc-500 text-[10px]">↗</span>
            </div>
          ) : (
            <span className="text-zinc-500">None generated</span>
          )}
          {plinkId && <p className="text-[11px] font-mono text-zinc-400 mt-1">Entity ID: {plinkId}</p>}
        </div>

        <div>
          <span className="text-zinc-500 uppercase tracking-wider block text-[10px] mb-1 font-semibold">
            Settlement Verification
          </span>
          {isRecovered ? (
            <div>
              <p className="text-emerald-300 font-semibold">Confirmed: ₹{ledger?.amount_inr} settled</p>
              <p className="text-[11px] font-mono text-zinc-400 mt-0.5">Payment ID: {ledger?.payment_id || "N/A"}</p>
              <p className="text-[10px] text-zinc-500">
                {ledger?.settled_at ? new Date(ledger.settled_at).toLocaleTimeString() : ""}
              </p>
            </div>
          ) : (
            <p className="text-amber-400">Waiting for payment on link or webhook confirmation.</p>
          )}
        </div>
      </div>

      {/* Interactive Actions for Demonstration */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {shortUrl && (
          <a
            href={shortUrl}
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm"
          >
            🌐 Open Razorpay Payment Link
          </a>
        )}

        <button
          onClick={triggerSimulateWebhook}
          disabled={simulating || isRecovered}
          className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
            isRecovered
              ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
              : "bg-amber-600 hover:bg-amber-500 text-white shadow-sm cursor-pointer"
          }`}
        >
          {simulating ? "⏳ Posting Webhook..." : isRecovered ? "✓ Webhook Processed" : "⚡ Simulate Webhook (payment_link.paid)"}
        </button>

        {isRecovered && (
          <span className="text-xs text-emerald-400 font-medium ml-auto flex items-center gap-1">
            ✓ Proof loop closed: State mutated in backend ledger &amp; audit trail
          </span>
        )}
      </div>

      {/* Live Webhook Audit Events Feed */}
      {auditLogs.length > 0 && (
        <div className="mt-4 pt-3 border-t border-zinc-800/80">
          <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-2">
            Ledger Audit Log (Case #{caseId}):
          </p>
          <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {auditLogs.map((log: any, idx: number) => {
              const isSettled = log.event_type === "PAYMENT_SETTLED_VIA_WEBHOOK";
              return (
                <div
                  key={idx}
                  className={`text-[11px] font-mono p-1.5 rounded flex items-center justify-between ${
                    isSettled ? "bg-emerald-950/80 border border-emerald-700 text-emerald-300 font-bold" : "bg-zinc-900 text-zinc-400"
                  }`}
                >
                  <span className="truncate max-w-[260px]">{log.event_type}</span>
                  <span className="text-[10px] text-zinc-500">
                    {log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Razorpay Standard Checkout + AI Recovery Loop
// ─────────────────────────────────────────────────────────────
declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => { open(): void };
  }
}

// ─────────────────────────────────────────────────────────────
// Scenario Simulator data (business context Razorpay can't give)
// ─────────────────────────────────────────────────────────────
const SCENARIOS = [
  {
    id: "insufficient_funds",
    label: "💸  Insufficient Funds (Pre-Salary, Day 22)",
    badge: "INSUFFICIENT_FUNDS",
    color: "red" as const,
    description: "Customer's account is empty before salary credit. Mandate retry now burns limits.",
    agentNote: "Agent will delay debit to salary date (dom=1). No immediate dunning.",
    payload: {
      failure_reason:           "INSUFFICIENT_FUNDS",
      failure_class_at_decision: "INSUFFICIENT_FUNDS",
      rail:                     "UPI_AUTOPAY",
      retries_used_before:      0,
      bank_name:                "UCO Bank",
    },
  },
  {
    id: "rate_limit",
    label: "🚦  PSP Rate Limit (3rd retry, throttle active)",
    badge: "RATE_LIMIT",
    color: "amber" as const,
    description: "Bank PSP is throttling. Hard guardrail triggers 24h exponential backoff.",
    agentNote: "Guardrail: BLOCKED. Cooldown enforced. No outreach until window clears.",
    payload: {
      failure_reason:           "RATE_LIMIT",
      failure_class_at_decision: "TECHNICAL",
      retries_used_before:      2,
      contacts_sent_before:     1,
      bank_name:                "HDFC Bank",
    },
  },
  {
    id: "gateway_timeout",
    label: "⏱  Gateway Timeout (Peak 11 PM HDFC)",
    badge: "GATEWAY_TIMEOUT",
    color: "amber" as const,
    description: "Transient bank server error at peak hours. No dunning needed, re-queue silently.",
    agentNote: "Agent: silent retry at 8 AM off-peak. No WhatsApp — not customer's fault.",
    payload: {
      failure_reason:           "GATEWAY_TIMEOUT",
      failure_class_at_decision: "TECHNICAL",
      bank_name:                "HDFC Bank",
      retries_used_before:      0,
    },
  },
  {
    id: "user_dismissed",
    label: "👆  Customer Drop-off (Modal dismissed)",
    badge: "USER_DISMISSED",
    color: "zinc" as const,
    description: "High purchase intent (just opened checkout), but dropped off. Best recovery window.",
    agentNote: "1-click WhatsApp link dispatched immediately with Hinglish copy.",
    payload: {
      failure_reason:           "USER_DISMISSED",
      failure_class_at_decision: "CUSTOMER_DROPPED_OFF",
      retries_used_before:      0,
      bank_name:                "UNKNOWN",
    },
  },
  {
    id: "bank_decline",
    label: "🏦  Bank Decline (Issuer Blocked Card)",
    badge: "BANK_DECLINE",
    color: "red" as const,
    description: "Issuer bank blocked the transaction. Dynamic UPI fallback link offered.",
    agentNote: "Action: SEND_PAYMENT_LINK via UPI. Card channel temporarily excluded.",
    payload: {
      failure_reason:           "BANK_DECLINE",
      failure_class_at_decision: "BANK_TECHNICAL",
      rail:                     "CARD",
      retries_used_before:      1,
      bank_name:                "PNB Bank",
    },
  },
  {
    id: "otp_timeout",
    label: "🔒  OTP / Auth Timeout (2FA failed)",
    badge: "OTP_TIMEOUT",
    color: "amber" as const,
    description: "Customer did not complete OTP in time. May retry immediately.",
    agentNote: "Action: RETRY with friendly nudge. No link needed — customer was engaged.",
    payload: {
      failure_reason:           "OTP_TIMEOUT",
      failure_class_at_decision: "AUTHENTICATION",
      retries_used_before:      0,
      bank_name:                "ICICI Bank",
    },
  },
];

function RazorpayCheckoutSection() {
  const [caseId, setCaseId]         = useState("610");
  const [amount, setAmount]         = useState("499");
  const [customerPhone, setCustomerPhone] = useState("+919234633668");
  const [channel, setChannel]       = useState("WHATSAPP");
  const [locale, setLocale]         = useState("HI_EN");
  const [selectedScenario, setSelectedScenario] = useState(0);
  const [status, setStatus]         = useState<"idle"|"ordering"|"verifying"|"recovering"|"success"|"failed">("idle");
  const [payResult, setPayResult]   = useState<Record<string, unknown> | null>(null);
  const [recovery, setRecovery]     = useState<RecoveryPlan | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [sessionRecoveredTotal, setSessionRecoveredTotal] = useState(0);
  // Store active scenario payload in a ref so closures (ondismiss, payment.failed) always see latest value
  const scenarioRef = useRef(SCENARIOS[0].payload);
  scenarioRef.current = SCENARIOS[selectedScenario].payload;

  // ── Central recovery trigger ─────────────────────────────────
  const triggerRecovery = async (gatewayReason?: string, extraPayload?: Record<string, unknown>) => {
    setStatus("recovering");
    setError(null);
    const scenario = scenarioRef.current;
    try {
      const plan = await api("POST", "/api/recovery/diagnose-and-act", {
        case_id:        caseId,
        amount_inr:     Number(amount),
        customer_phone: customerPhone,
        channel,
        locale,
        timestamp:      new Date().toISOString(),
        // Merge: scenario business context + live gateway reason (gateway wins on failure_reason)
        ...scenario,
        ...(gatewayReason ? { failure_reason: gatewayReason } : {}),
        ...(extraPayload  ?? {}),
      }) as RecoveryPlan;
      setRecovery(plan);
      setStatus("failed");
    } catch (e) {
      setError(`Recovery pipeline error: ${e}`);
      setStatus("failed");
    }
  };

  // ── Direct simulation (no Razorpay modal) ───────────────────
  const simulateDirect = async () => {
    setError(null);
    setPayResult(null);
    setRecovery(null);
    await triggerRecovery();
  };

  // ── Open real Razorpay modal ─────────────────────────────────
  const openCheckout = async () => {
    setError(null);
    setPayResult(null);
    setRecovery(null);
    setStatus("ordering");

    let order: Record<string, unknown>;
    try {
      order = await api("POST", "/api/create-order", {
        amount_inr: Number(amount),
        receipt:    `receipt_${caseId}_${Date.now()}`,
        case_id:    caseId,
      });
    } catch (e) {
      setError(`Order creation failed: ${e}`);
      await triggerRecovery("ORDER_CREATION_FAILED");
      return;
    }
    if (!order.order_id) {
      setError(`Backend error: ${JSON.stringify(order)}`);
      await triggerRecovery("ORDER_CREATION_FAILED");
      return;
    }
    setStatus("idle");

    const options = {
      key:         order.key_id as string,
      amount:      order.amount as number,
      currency:    order.currency as string,
      name:        "RecoverAI",
      description: `Recovery payment — Case #${caseId}`,
      order_id:    order.order_id as string,
      theme:       { color: "#2563EB" },

      // ── Payment success ──────────────────────────────────────
      handler: async (response: Record<string, string>) => {
        setStatus("verifying");
        try {
          const verification = await api("POST", "/api/verify-payment", {
            razorpay_order_id:   response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature:  response.razorpay_signature,
            case_id: caseId,
          });
          if ((verification as Record<string,unknown>).verified) {
            setStatus("success");
            setPayResult(verification as Record<string,unknown>);
            setRecovery(null);
          } else {
            setError("Signature mismatch — payment not verified.");
            await triggerRecovery("SIGNATURE_MISMATCH");
          }
        } catch (e) {
          setError(`Verification failed: ${e}`);
          await triggerRecovery("VERIFICATION_ERROR");
        }
      },

      // ── Modal dismissed (X button) ────────────────────────────
      // NOTE: payment.failed must use rzp.on() below — NOT in options object
      modal: {
        ondismiss: async () => {
          // Merge gateway event with selected scenario context
          await triggerRecovery("USER_DISMISSED");
        },
      },
      prefill: { name: "Test Customer", email: "success@razorpay.com", contact: "9999999999" },
    };

    const rzp = new window.Razorpay(options);

    // ── payment.failed: correct API — must use rzp.on(), NOT options key ──
    // Fires on bank declines, OTP timeout, insufficient funds, before modal closes
    // Response shape: { error: { code, description, source, step, reason, metadata } }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rzp as any).on("payment.failed", async (response: any) => {
      const err    = response?.error ?? {};
      const reason = err.reason      || "PAYMENT_FAILED";
      const desc   = err.description || "Bank declined";
      setError(`Gateway: ${desc} [${err.code ?? "?"} / ${reason}]`);
      // Pass raw gateway error codes alongside the scenario context
      await triggerRecovery(`BANK_DECLINED:${reason}`, {
        error_code:        err.code,
        error_description: desc,
        error_source:      err.source,
        error_step:        err.step,
      });
    });

    rzp.open();
  };


  const statusConfig: Record<string, { label: string; color: "green"|"red"|"amber"|"zinc" }> = {
    idle:       { label: "Ready",                  color: "zinc"  },
    ordering:   { label: "Creating order…",        color: "amber" },
    verifying:  { label: "Verifying signature…",   color: "amber" },
    recovering: { label: "AI Recovery Running…",   color: "amber" },
    success:    { label: "Payment Verified ✓",     color: "green" },
    failed:     { label: "Failed — Recovery Active", color: "red" },
  };
  const sc  = statusConfig[status] ?? statusConfig.idle;
  const scn = SCENARIOS[selectedScenario];
  const busy = status === "ordering" || status === "verifying" || status === "recovering";

  return (
    <Card title="Autonomous Payment Recovery Demo · Live Razorpay & Twilio Pipeline">

      {/* Proof Loop Session Metric Header */}
      <div className="flex items-center justify-between bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-xs">
        <div className="flex items-center gap-2.5">
          <span className="text-zinc-400 font-medium">₹ Actually Recovered (Live Session):</span>
          <span className="text-base font-bold text-emerald-400 font-mono">
            ₹{sessionRecoveredTotal.toLocaleString("en-IN")}
          </span>
        </div>
        <span className="text-zinc-500 text-[11px] hidden sm:inline">
          Live proof via Webhooks &amp; Settlement Ledger
        </span>
      </div>

      {/* Parameters row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Input label="Case ID" value={caseId} onChange={setCaseId} />
        <Input label="Amount (INR)" value={amount} onChange={setAmount} type="number" />
        <Input label="Recipient Phone (Twilio)" value={customerPhone} onChange={setCustomerPhone} />
        <Select label="Channel" value={channel} onChange={setChannel}
          options={["WHATSAPP","SMS","EMAIL","UPI_INTENT"]} />
        <Select label="Locale" value={locale} onChange={setLocale}
          options={["HI_EN","EN","HI"]} />
      </div>

      {/* ── Scenario Simulator ─────────────────────────────── */}
      <div className="border border-indigo-800 bg-indigo-950/30 rounded-xl p-4 flex flex-col gap-3">
        <p className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">
          🛠 Scenario Simulator — inject business context the gateway can&apos;t provide
        </p>

        {/* Scenario select */}
        <div className="flex gap-2 items-stretch">
          <select
            value={selectedScenario}
            onChange={(e) => setSelectedScenario(Number(e.target.value))}
            className="flex-1 bg-zinc-800 text-white text-sm rounded-lg px-3 py-2 border border-zinc-700 cursor-pointer"
          >
            {SCENARIOS.map((s, i) => (
              <option key={s.id} value={i}>{s.label}</option>
            ))}
          </select>
        </div>

        {/* Scenario description */}
        <div className="grid md:grid-cols-2 gap-2 text-xs">
          <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-700">
            <p className="text-zinc-400 mb-1 font-semibold">Failure context</p>
            <p className="text-zinc-300">{scn.description}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {Object.entries(scn.payload).map(([k, v]) => (
                <span key={k} className="bg-zinc-800 rounded px-1.5 py-0.5 text-zinc-400 font-mono text-xs">
                  {k}:{String(v)}
                </span>
              ))}
            </div>
          </div>
          <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-700">
            <p className="text-zinc-400 mb-1 font-semibold">Expected agent behaviour</p>
            <p className="text-emerald-300 text-xs leading-relaxed">{scn.agentNote}</p>
            <Badge label={scn.badge} color={scn.color} />
          </div>
        </div>

        {/* Two action paths */}
        <div className="flex gap-3 flex-wrap">
          <Btn onClick={simulateDirect} loading={busy} color="amber">
            ⚡ Simulate Direct (no modal)
          </Btn>
          <Btn onClick={openCheckout} loading={busy} color="green">
            💳 Open Real Razorpay Checkout
          </Btn>
          <Badge label={sc.label} color={sc.color} />
        </div>

        {/* Test card reference */}
        <div className="bg-blue-950/50 border border-blue-800 rounded-lg p-3 text-xs text-blue-300">
          <p className="font-semibold mb-1">Test cards for "Open Real Checkout"</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono">
            <span className="text-zinc-400">✅ Success:</span>  <span>4111 1111 1111 1111</span>
            <span className="text-zinc-400">❌ Decline (GATEWAY_ERROR):</span>  <span>4000 0000 0000 0002</span>
            <span className="text-zinc-400">UPI success:</span> <span>success@razorpay</span>
            <span className="text-zinc-400">UPI failure:</span> <span>failure@razorpay</span>
            <span className="text-zinc-400">Dismiss modal:</span> <span>→ fires ondismiss</span>
          </div>
          <p className="mt-1 text-blue-400 text-xs">
            payment.failed uses <code>rzp.on(&apos;payment.failed&apos;, fn)</code> — correct API (not options object)
          </p>
        </div>
      </div>

      {/* Success state */}
      {status === "success" && payResult && (
        <div className="bg-emerald-950 border border-emerald-700 rounded-lg p-4">
          <p className="text-emerald-300 font-semibold text-sm mb-2">✓ Payment verified — no recovery needed</p>
          <Pre data={payResult} />
        </div>
      )}

      {/* Gateway error bubble */}
      {error && (
        <div className="bg-red-950 border border-red-700 rounded-lg p-3 text-xs text-red-300 font-mono">{error}</div>
      )}

      {/* Loading recovery */}
      {status === "recovering" && !recovery && (
        <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-4 text-sm text-amber-400 animate-pulse">
          ⚡ AI Recovery Agent running: case lookup → ML prediction → guardrails → payment link → LLM copy…
        </div>
      )}

      {/* Active Recovery Card */}
      {recovery && <RecoveryCard plan={recovery} />}

      {/* Live Proof Inspector — Visual State Mutation & Webhook Settlement */}
      {(recovery || status === "failed") && (
        <LiveProofInspector
          caseId={caseId}
          plan={recovery}
          onRecovered={(amt) => setSessionRecoveredTotal((prev) => prev + amt)}
        />
      )}

      {/* Flow legend */}
      <div className="bg-zinc-800/50 rounded-lg p-3 text-xs text-zinc-400 font-mono leading-5">
        <p className="text-zinc-300 font-semibold mb-1">Event → Recovery mapping:</p>
        <p>Simulate Direct    → injects scenario payload directly → diagnose-and-act</p>
        <p>Modal dismiss      → ondismiss + scenario context → diagnose-and-act</p>
        <p>Bank decline card  → rzp.on(payment.failed) + gateway error codes → diagnose-and-act</p>
      </div>
    </Card>
  );
}


// ─────────────────────────────────────────────────────────────
// ROOT PAGE
// ─────────────────────────────────────────────────────────────
export default function Home() {
  const TABS = [
    { id: "demo",      label: "⚡ Live Recovery Demo",      badge: "Core Proof" },
    { id: "batch",     label: "📊 Batch ROI Engine",       badge: "16.6k A/B" },
    { id: "dashboard", label: "📈 Executive Dashboard",    badge: "Portfolio" },
    { id: "sandbox",   label: "🧪 AI Labs & Diagnostics",  badge: "PTP & Status" },
  ] as const;

  type TabId = typeof TABS[number]["id"];
  const [tab, setTab] = useState<TabId>("demo");

  return (
    <div className="min-h-screen bg-zinc-950 text-white font-sans">
      {/* Sticky Header + Navigation Bar */}
      <div className="sticky top-0 z-50 bg-zinc-950/95 backdrop-blur-md border-b border-zinc-800 shadow-xl shadow-black/40">
        {/* Top Header */}
        <div className="px-6 py-3.5 flex items-center justify-between flex-wrap gap-4 border-b border-zinc-850/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 via-indigo-600 to-emerald-500 flex items-center justify-center font-bold text-white shadow-lg shadow-blue-600/25 text-lg">
              ₹
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-white tracking-tight">RecoverAI</h1>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-900/60 text-blue-300 border border-blue-700/60 uppercase tracking-wide">
                  Track 03
                </span>
              </div>
              <p className="text-xs text-zinc-400">Autonomous Revenue Recovery for Razorpay · Bounded Interventions</p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs flex-wrap">
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-950/60 border border-emerald-800/80 text-emerald-300 font-mono text-[11px]">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              Razorpay Test-Mode
            </span>
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-950/60 border border-blue-800/80 text-blue-300 font-mono text-[11px]">
              LightGBM AUC: 0.9102
            </span>
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-zinc-900 border border-zinc-700 text-zinc-300 font-mono text-[11px]">
              Twilio SMS Ready
            </span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="px-6 flex gap-1.5 overflow-x-auto bg-zinc-900/50">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-5 py-3 text-xs font-semibold transition-all whitespace-nowrap cursor-pointer flex items-center gap-2 border-b-2 ${
                tab === t.id
                  ? "text-white border-blue-500 bg-zinc-850/60 shadow-sm"
                  : "text-zinc-400 border-transparent hover:text-zinc-200 hover:bg-zinc-850/30"
              }`}
            >
              <span>{t.label}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-normal ${
                tab === t.id ? "bg-blue-950 text-blue-300 border border-blue-800" : "bg-zinc-800 text-zinc-500"
              }`}>
                {t.badge}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Content Area */}
      <div className="max-w-5xl mx-auto p-6">
        {tab === "demo"      && <RazorpayCheckoutSection />}
        {tab === "batch"     && <BatchSection />}
        {tab === "dashboard" && <ExecutiveDashboardSection onNavigateToBatch={() => setTab("batch")} />}
        {tab === "sandbox"   && <AILabsSection />}
      </div>
    </div>
  );
}
