"use client";
import { useState } from "react";

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

const Badge = ({ label, color }: { label: string; color: "green" | "red" | "amber" | "blue" | "zinc" }) => {
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
          {(data.execution_details as Record<string, unknown>)?.short_url && (
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
  const [sampleSize, setSampleSize] = useState("500");
  const [data, setData]             = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading]       = useState(false);

  const run = async () => {
    setLoading(true);
    setData(await api("POST", "/api/batch/run", { sample_size: Number(sampleSize) }));
    setLoading(false);
  };

  const b  = data?.baseline  as Record<string, unknown> | undefined;
  const ai = data?.recoverai as Record<string, unknown> | undefined;

  return (
    <Card title="4 · Batch Simulation  POST /api/batch/run">
      <div className="flex gap-3 items-end">
        <Input label="Sample Size (max 16663)" value={sampleSize} onChange={setSampleSize} type="number" />
        <Btn onClick={run} loading={loading} color="amber">Run Batch</Btn>
      </div>

      {b && ai && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="border-b border-zinc-700">
                <th className="py-2 pr-4 text-zinc-400">Metric</th>
                <th className="py-2 pr-4 text-zinc-300">Baseline</th>
                <th className="py-2 text-blue-400">RecoverAI</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Cases",          data.cases_evaluated,          data.cases_evaluated],
                ["Actions",        b.actions_attempted,           ai.actions_attempted],
                ["Attributed Rec", b.attributed_recoveries,       ai.attributed_recoveries],
                ["Counterfactual", b.counterfactual_cases,        ai.counterfactual_cases],
                ["Gross (INR)",    `₹${b.gross_recovered_inr}`,   `₹${ai.gross_recovered_inr}`],
                ["Cost (INR)",     `₹${b.total_intervention_cost_inr}`, `₹${ai.total_intervention_cost_inr}`],
                ["Net (INR)",      `₹${b.net_recovered_inr}`,     `₹${ai.net_recovered_inr}`],
                ["Rate",           `${b.recovery_rate_pct}%`,     `${ai.recovery_rate_pct}%`],
              ].map(([m, bv, rv]) => (
                <tr key={String(m)} className="border-b border-zinc-800 hover:bg-zinc-800/50">
                  <td className="py-1.5 pr-4 text-zinc-400">{m}</td>
                  <td className="py-1.5 pr-4 text-zinc-300">{String(bv)}</td>
                  <td className="py-1.5 text-blue-300 font-semibold">{String(rv)}</td>
                </tr>
              ))}
              <tr className="bg-emerald-900/30">
                <td className="py-2 pr-4 text-emerald-400 font-bold">Incremental</td>
                <td></td>
                <td className="py-2 text-emerald-300 font-bold">+₹{data.incremental_revenue_inr} ({data.recovery_uplift_pct}%)</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {data && <Pre data={{ guardrail_stats: data.guardrail_stats, ml_metrics: data.ml_metrics }} />}
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
          {data.payment_link && (
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
          {data.promised_date && <Badge label={`Date: ${data.promised_date}`} color="amber" />}
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
                  <td className="py-1.5 pr-3 text-zinc-300 font-mono">#{c.case_id}</td>
                  <td className="py-1.5 pr-3">₹{c.amount_inr}</td>
                  <td className="py-1.5 pr-3 text-zinc-400 text-xs">{String(c.failure_class).replace(/_/g,' ')}</td>
                  <td className="py-1.5 pr-3">
                    <span className={`font-semibold ${Number(c.recovery_probability) > 0.6 ? 'text-emerald-400' : Number(c.recovery_probability) > 0.35 ? 'text-amber-400' : 'text-red-400'}`}>
                      {Number(c.recovery_probability).toFixed(2)}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 text-emerald-300">₹{c.expected_recovery_inr}</td>
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
// ROOT PAGE
// ─────────────────────────────────────────────────────────────
export default function Home() {
  const TABS = ["Health","Analyze","Execute","Batch","Dunning","PTP","Audit","Cases","Dashboard"] as const;
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
      </div>
    </div>
  );
}
