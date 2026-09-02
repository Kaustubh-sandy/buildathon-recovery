"use client";
import React, { useState, useRef } from "react";

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

function HealthSection() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    setData(await api("GET", "/api/health"));
    setLoading(false);
  };

  return (
    <Card title="1 · Health Check  GET /api/health">
      <Btn onClick={run} loading={loading}>Check Health</Btn>
      {data && (
        <div className="flex flex-wrap gap-2">
          <Badge label={String(data.status)} color={statusColor(String(data.status))} />
          <Badge label={`Model: ${data.model_loaded ? "loaded" : "not loaded"}`} color={data.model_loaded ? "green" : "red"} />
          <Badge label={`AUC: ${data.model_auc ?? "N/A"}`} color="blue" />
          <Badge label={`LLM: ${data.llm_available ? "Gemini" : "fallback"}`} color={data.llm_available ? "green" : "amber"} />
          <Badge label={`Razorpay: ${data.razorpay_mock ? "mock" : "test-mode"}`} color={data.razorpay_mock ? "amber" : "green"} />
        </div>
      )}
      {data && <Pre data={data} />}
    </Card>
  );
}

function AnalyzeSection() {
  const [caseId, setCaseId]   = useState("610");
  const [amount, setAmount]   = useState("8500");
  const [failure, setFailure] = useState("INSUFFICIENT_FUNDS");
  const [retries, setRetries] = useState("0");
  const [rail, setRail]       = useState("UPI_AUTOPAY");
  const [data, setData]       = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    setData(await api("POST", "/api/recovery/analyze", {
      case_id: caseId,
      amount_inr: Number(amount),
      failure_class_at_decision: failure,
      retries_used_before: Number(retries),
      rail,
    }));
    setLoading(false);
  };

  return (
    <Card title="2 · Analyze Case  POST /api/recovery/analyze">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Input label="Case ID" value={caseId} onChange={setCaseId} />
        <Input label="Amount (INR)" value={amount} onChange={setAmount} type="number" />
        <Input label="Retries Used" value={retries} onChange={setRetries} type="number" />
        <Select label="Failure Class" value={failure} onChange={setFailure}
          options={["INSUFFICIENT_FUNDS","BANK_TECHNICAL","RATE_LIMIT","MANDATE_CLOSED","MANDATE_PAUSED","CARD_EXPIRED","CARD_LOST_STOLEN"]} />
        <Select label="Rail" value={rail} onChange={setRail} options={["UPI_AUTOPAY","CARD_SI"]} />
      </div>
      <Btn onClick={run} loading={loading} color="blue">Analyze</Btn>
      {data && (
        <div className="flex flex-wrap gap-2">
          <Badge label={`P(recovery): ${data.recovery_probability}`} color="blue" />
          <Badge label={String(data.risk_level)} color={data.risk_level === "LOW" ? "green" : data.risk_level === "HIGH" ? "red" : "amber"} />
          <Badge label={String(data.recommended_action)} color="zinc" />
          <Badge label={String(data.policy_status)} color={statusColor(String(data.policy_status))} />
          <Badge label={`ERV: ₹${data.expected_recovery_inr}`} color="green" />
        </div>
      )}
      {data && <Pre data={data} />}
    </Card>
  );
}

function ExecuteSection() {
  const [caseId, setCaseId]   = useState("610");
  const [amount, setAmount]   = useState("8500");
  const [action, setAction]   = useState("RETRY");
  const [data, setData]       = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    setData(await api("POST", "/api/recovery/execute", {
      case_id: caseId,
      action,
      amount_inr: Number(amount),
      customer_name: "Test Customer",
      customer_email: "test@example.com",
      customer_phone: "9999999999",
    }));
    setLoading(false);
  };

  return (
    <Card title="3 · Execute Action  POST /api/recovery/execute">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Input label="Case ID" value={caseId} onChange={setCaseId} />
        <Input label="Amount (INR)" value={amount} onChange={setAmount} type="number" />
        <Select label="Action" value={action} onChange={setAction}
          options={["RETRY","SEND_PAYMENT_LINK","SEND_REMINDER","CHANGE_PAYMENT_METHOD","ESCALATE"]} />
      </div>
      <Btn onClick={run} loading={loading} color="green">Execute</Btn>
      {data && (
        <div className="flex flex-wrap gap-2">
          <Badge label={String(data.status)} color={statusColor(String(data.status))} />
          <Badge label={`Action: ${data.executed_action ?? data.action}`} color="zinc" />
          {Boolean((data.execution_details as Record<string, unknown>)?.short_url) && (
            <a href={String((data.execution_details as Record<string, unknown>).short_url)}
               className="text-blue-400 text-xs underline" target="_blank">Payment Link →</a>
          )}
        </div>
      )}
      {data && <Pre data={data} />}

    </Card>
  );
}

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
    <Card title="4 · Batch Recovery & Custom CSV Upload  POST /api/batch/run & /api/batch/upload">

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
            <div className="flex flex-col gap-2 bg-zinc-950/80 border border-zinc-800 rounded-xl p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-blue-400">
                    🤖 Batch Process Audit Trail & Agent Timeline ({batchLog.length} Milestones)
                  </span>
                  <Badge label="SYSTEM AUDIT" color="zinc" />
                </div>
                <button
                  onClick={() => setShowBatchLog(!showBatchLog)}
                  className="text-xs text-zinc-400 hover:text-white underline cursor-pointer"
                >
                  {showBatchLog ? "Hide Timeline" : "Show Timeline"}
                </button>
              </div>

              {showBatchLog && (
                <div className="flex flex-col gap-2 mt-2">
                  {batchLog.map((logItem, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-3 bg-zinc-900/90 border border-zinc-800/80 rounded-lg p-2.5 text-xs font-mono"
                    >
                      <div className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                      <div className="flex flex-col gap-0.5 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-blue-300">
                            {String(logItem.agent_label || logItem.agent)}
                          </span>
                          <Badge label={String(logItem.event)} color="zinc" />
                          <span className="text-[10px] text-zinc-500 ml-auto font-sans">
                            {String(logItem.timestamp).replace("T", " ").substring(0, 19)}
                          </span>
                        </div>
                        <p className="text-zinc-300 text-[11px] mt-0.5 font-sans leading-relaxed">
                          {String(logItem.message)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Per-Transaction Decisioning Table & Inspector ───── */}
          {details.length > 0 && (
            <div className="flex flex-col gap-3 mt-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                  📋 Transaction Decision Ledger (showing top {details.length} rows — click any row to inspect full agent trace)
                </p>
                <span className="text-[11px] text-zinc-500">Click a row for Agent Reasoning Trace</span>
              </div>

              <div className="overflow-x-auto max-h-72 overflow-y-auto border border-zinc-800 rounded-lg">
                <table className="w-full text-[11px] text-left border-collapse">
                  <thead className="sticky top-0 bg-zinc-900 border-b border-zinc-700">
                    <tr>
                      <th className="py-2 px-2 text-zinc-400">Txn ID</th>
                      <th className="py-2 px-2 text-zinc-400">Customer</th>
                      <th className="py-2 px-2 text-zinc-400">Amount</th>
                      <th className="py-2 px-2 text-zinc-400">Failure Code</th>
                      <th className="py-2 px-2 text-zinc-400">Method</th>
                      <th className="py-2 px-2 text-zinc-400">P(rec)</th>
                      <th className="py-2 px-2 text-zinc-400">ERV</th>
                      <th className="py-2 px-2 text-zinc-400">RecoverAI Action</th>
                      <th className="py-2 px-2 text-zinc-400">Guardrail</th>
                      <th className="py-2 px-2 text-zinc-400 text-center">Audit Trace</th>
                    </tr>
                  </thead>
                  <tbody>
                    {details.map((c) => {
                      const isSelected = selectedTxn && selectedTxn.transaction_id === c.transaction_id;
                      return (
                        <tr
                          key={String(c.transaction_id)}
                          onClick={() => setSelectedTxn(c)}
                          className={`border-b border-zinc-800/60 font-mono cursor-pointer transition-colors ${
                            isSelected ? "bg-blue-950/50 border-blue-600" : "hover:bg-zinc-800/40"
                          }`}
                        >
                          <td className="py-1.5 px-2 text-zinc-300 font-bold">{String(c.transaction_id)}</td>
                          <td className="py-1.5 px-2 text-zinc-400">{String(c.customer_id)}</td>
                          <td className="py-1.5 px-2 text-white font-semibold">₹{String(c.amount_inr)}</td>
                          <td className="py-1.5 px-2 text-zinc-400">{String(c.failure_code)}</td>
                          <td className="py-1.5 px-2 text-zinc-400">{String(c.payment_method)}</td>
                          <td className="py-1.5 px-2 text-blue-300 font-semibold">{String(c.p_recovery)}</td>
                          <td className="py-1.5 px-2 text-emerald-300">₹{String(c.erv)}</td>
                          <td className="py-1.5 px-2">
                            <Badge label={String(c.recommended_action)} color="zinc" />
                          </td>
                          <td className="py-1.5 px-2">
                            <Badge label={String(c.guardrail_status)} color={statusColor(String(c.guardrail_status))} />
                          </td>
                          <td className="py-1.5 px-2 text-center">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedTxn(c);
                              }}
                              className={`text-[10px] px-2 py-0.5 rounded font-sans font-semibold transition-all cursor-pointer ${
                                isSelected
                                  ? "bg-blue-600 text-white"
                                  : "bg-zinc-800 text-blue-400 hover:bg-zinc-700"
                              }`}
                            >
                              🔍 View Trace
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


function DunningSection() {
  const [caseId, setCaseId]   = useState("610");
  const [amount, setAmount]   = useState("1200");
  const [channel, setChannel] = useState("WHATSAPP");
  const [locale, setLocale]   = useState("HI_EN");
  const [failure, setFailure] = useState("INSUFFICIENT_FUNDS");
  const [data, setData]       = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    setData(await api("POST", "/api/dunning/generate", {
      case_id: caseId, amount_inr: Number(amount),
      failure_class_at_decision: failure, channel, locale,
    }));
    setLoading(false);
  };

  return (
    <Card title="5 · Dunning Generator  POST /api/dunning/generate">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Input label="Case ID" value={caseId} onChange={setCaseId} />
        <Input label="Amount (INR)" value={amount} onChange={setAmount} type="number" />
        <Select label="Channel" value={channel} onChange={setChannel} options={["WHATSAPP","SMS","EMAIL","UPI_INTENT"]} />
        <Select label="Locale" value={locale} onChange={setLocale} options={["HI_EN","EN","HI"]} />
        <Select label="Failure Class" value={failure} onChange={setFailure}
          options={["INSUFFICIENT_FUNDS","BANK_TECHNICAL","MANDATE_CLOSED","CARD_EXPIRED"]} />
      </div>
      <Btn onClick={run} loading={loading} color="blue">Generate Message</Btn>
      {data && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Badge label={String(data.channel)} color="zinc" />
            <Badge label={String(data.locale)} color="zinc" />
            <Badge label={`via: ${data.method}`} color={data.method === "llm" ? "green" : "amber"} />
          </div>
          <div className="bg-zinc-800 rounded-lg p-3 text-sm text-white whitespace-pre-wrap leading-relaxed border border-zinc-600">
            {String(data.message_body)}
          </div>
          {Boolean(data.payment_link) && (
            <p className="text-xs text-blue-400">Link: {String(data.payment_link)}</p>
          )}
        </div>
      )}
    </Card>
  );
}

function PTPSection() {
  const [text, setText]     = useState("bhai salary 5 ko aayegi uske baad kar dunga");
  const [data, setData]     = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    setData(await api("POST", "/api/dunning/parse-ptp", { text }));
    setLoading(false);
  };

  const TESTS = [
    "I haven't paid",
    "I already paid",
    "payment done kar diya",
    "bhai salary 5 ko aayegi uske baad kar dunga",
    "will pay on 10th",
    "link kaam nahi kar raha error aa raha hai",
    "stop messaging me",
    "why did my payment fail?",
  ];

  return (
    <Card title="6 · PTP Parser  POST /api/dunning/parse-ptp">
      <div className="flex flex-col gap-2">
        <label className="text-xs text-zinc-400">Customer reply text</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          className="bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 resize-none"
        />
        <div className="flex flex-wrap gap-2">
          {TESTS.map((t) => (
            <button key={t} onClick={() => setText(t)}
              className="text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-300 px-2 py-1 rounded cursor-pointer">
              {t.substring(0, 30)}…
            </button>
          ))}
        </div>
      </div>
      <Btn onClick={run} loading={loading} color="blue">Parse</Btn>
      {data && (
        <div className="flex flex-wrap gap-2">
          <Badge label={String(data.intent)} color={
            data.intent === "PAY_NOW" || data.intent === "PROMISE_TO_PAY" ? "green" :
            data.intent === "REFUSAL_OPT_OUT" || data.intent === "FAILED_RAIL" ? "red" : "zinc"
          } />
          <Badge label={String(data.sentiment)} color={
            data.sentiment === "POSITIVE" ? "green" : data.sentiment === "NEGATIVE" ? "red" : "zinc"
          } />
          <Badge label={`conf: ${data.confidence}`} color="blue" />
          {Boolean(data.promised_date) && <Badge label={`Date: ${String(data.promised_date)}`} color="amber" />}
          <Badge label={String(data.recommended_next_state)} color="zinc" />
          <Badge label={`via: ${data.parse_method}`} color={data.parse_method === "llm" ? "green" : "amber"} />
        </div>
      )}
      {data && <Pre data={data} />}
    </Card>
  );
}

function AuditSection() {
  const [caseId, setCaseId] = useState("610");
  const [data, setData]     = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    setData(await api("GET", `/api/audit/${caseId}`));
    setLoading(false);
  };

  const logs = data?.logs as Array<Record<string, unknown>> | undefined;

  return (
    <Card title="7 · Audit Trail  GET /api/audit/:case_id">
      <div className="flex gap-3 items-end">
        <Input label="Case ID" value={caseId} onChange={setCaseId} />
        <Btn onClick={run} loading={loading} color="zinc">Fetch Audit</Btn>
      </div>
      {logs && logs.length === 0 && (
        <p className="text-xs text-zinc-500">No audit events yet. Analyze or execute a case first.</p>
      )}
      {logs && logs.length > 0 && (
        <div className="flex flex-col gap-2">
          {logs.map((log) => (
            <div key={String(log.event_id)} className="bg-zinc-800 rounded-lg p-3 border border-zinc-700">
              <div className="flex items-center gap-2 mb-1">
                <Badge label={String(log.event_type)} color="blue" />
                <span className="text-xs text-zinc-500">{String(log.timestamp)}</span>
                <span className="text-xs text-zinc-600 ml-auto">{String(log.event_id)}</span>
              </div>
              <Pre data={log.details} />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function CasesSection() {
  const [limit, setLimit]   = useState("5");
  const [data, setData]     = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    setData(await api("GET", `/api/cases?limit=${limit}&offset=0`));
    setLoading(false);
  };

  const cases = data?.cases as Array<Record<string, unknown>> | undefined;

  return (
    <Card title="8 · Case Queue  GET /api/cases">
      <div className="flex gap-3 items-end">
        <Input label="Limit" value={limit} onChange={setLimit} type="number" />
        <Btn onClick={run} loading={loading} color="zinc">Load Cases</Btn>
      </div>
      {data && <p className="text-xs text-zinc-500">Total: {String(data.total)} cases in dataset</p>}
      {cases && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="border-b border-zinc-700">
                {["case_id","amount_inr","failure_class","P(rec)","ERV","action","status"].map(h => (
                  <th key={h} className="py-2 pr-3 text-zinc-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={String(c.case_id)} className="border-b border-zinc-800 hover:bg-zinc-800/50">
                  <td className="py-1.5 pr-3 text-zinc-300 font-mono">#{String(c.case_id)}</td>
                  <td className="py-1.5 pr-3">₹{String(c.amount_inr)}</td>
                  <td className="py-1.5 pr-3 text-zinc-400 text-xs">{String(c.failure_class).replace(/_/g,' ')}</td>
                  <td className="py-1.5 pr-3">
                    <span className={`font-semibold ${Number(c.recovery_probability) > 0.6 ? 'text-emerald-400' : Number(c.recovery_probability) > 0.35 ? 'text-amber-400' : 'text-red-400'}`}>
                      {Number(c.recovery_probability).toFixed(2)}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 text-emerald-300">₹{String(c.expected_recovery_inr)}</td>
                  <td className="py-1.5 pr-3"><Badge label={String(c.recommended_action)} color="zinc" /></td>
                  <td className="py-1.5"><Badge label={String(c.policy_status)} color={statusColor(String(c.policy_status))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}


function DashboardSection() {
  const [data, setData]     = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    setData(await api("GET", "/api/dashboard"));
    setLoading(false);
  };

  return (
    <Card title="9 · Dashboard  GET /api/dashboard">
      <Btn onClick={run} loading={loading} color="zinc">Load Dashboard</Btn>
      {data?.status === "no_batch_run" && (
        <p className="text-amber-400 text-sm">No batch run yet — use section 4 first.</p>
      )}
      {data?.status === "available" && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { label: "Cases Evaluated",     value: data.cases_evaluated },
            { label: "Revenue at Risk",      value: `₹${data.revenue_at_risk_inr}` },
            { label: "Net Recovered",        value: `₹${data.recoverai_net_recovered_inr}` },
            { label: "Recovery Rate",        value: `${data.recoverai_recovery_rate_pct}%` },
            { label: "Baseline Rate",        value: `${data.baseline_recovery_rate_pct}%` },
            { label: "Incremental Revenue",  value: `₹${data.incremental_revenue_inr}` },
          ].map(({ label, value }) => (
            <div key={label} className="bg-zinc-800 rounded-lg p-3 border border-zinc-700">
              <p className="text-xs text-zinc-400">{label}</p>
              <p className="text-lg font-bold text-white">{String(value)}</p>
            </div>
          ))}
        </div>
      )}
      {data && <Pre data={data} />}
    </Card>
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
  };
  audit_steps: Array<{ step: string; timestamp: string; detail: Record<string, unknown> }>;
  elapsed_ms: number;
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
  const [channel, setChannel]       = useState("WHATSAPP");
  const [locale, setLocale]         = useState("HI_EN");
  const [selectedScenario, setSelectedScenario] = useState(0);
  const [status, setStatus]         = useState<"idle"|"ordering"|"verifying"|"recovering"|"success"|"failed">("idle");
  const [payResult, setPayResult]   = useState<Record<string, unknown> | null>(null);
  const [recovery, setRecovery]     = useState<RecoveryPlan | null>(null);
  const [error, setError]           = useState<string | null>(null);
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
    <Card title="10 · Razorpay Checkout + AI Recovery Loop">

      {/* Parameters row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Input label="Case ID" value={caseId} onChange={setCaseId} />
        <Input label="Amount (INR)" value={amount} onChange={setAmount} type="number" />
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
  const TABS = ["Health","Analyze","Execute","Batch","Dunning","PTP","Audit","Cases","Dashboard","Razorpay"] as const;
  const [tab, setTab] = useState<typeof TABS[number]>("Health");

  return (
    <div className="min-h-screen bg-zinc-950 text-white font-mono">
      {/* Header */}
      <div className="border-b border-zinc-800 px-6 py-4 flex items-center gap-4">
        <div>
          <h1 className="text-lg font-bold text-white">RecoverAI</h1>
          <p className="text-xs text-zinc-500">Backend Test Console · localhost:8000</p>
        </div>
        <span className="ml-auto text-xs text-zinc-600">all numbers real, none fabricated</span>
      </div>

      {/* Tabs */}
      <div className="border-b border-zinc-800 px-4 flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-3 text-sm transition-colors whitespace-nowrap cursor-pointer
              ${tab === t ? "text-white border-b-2 border-blue-500" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto p-6">
        {tab === "Health"    && <HealthSection />}
        {tab === "Analyze"   && <AnalyzeSection />}
        {tab === "Execute"   && <ExecuteSection />}
        {tab === "Batch"     && <BatchSection />}
        {tab === "Dunning"   && <DunningSection />}
        {tab === "PTP"       && <PTPSection />}
        {tab === "Audit"     && <AuditSection />}
        {tab === "Cases"     && <CasesSection />}
        {tab === "Dashboard" && <DashboardSection />}
        {tab === "Razorpay"  && <RazorpayCheckoutSection />}
      </div>
    </div>
  );
}
