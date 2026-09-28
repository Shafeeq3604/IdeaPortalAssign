import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ClipboardList, Coins, FlaskConical, Gauge } from "lucide-react";
import {
  Badge, Button, Card, CardContent, CardHeader, CardTitle, ErrorState, Input, Label, Select,
  SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, Textarea,
} from "@iep/ui";
import type { IdeaDeliveryResponse, KpiView, PilotOutcome } from "@iep/contracts";
import { IdeaShell } from "../ideas/IdeaShell";
import { STATUS_LABEL } from "../ideas/api";
import { ApiError } from "../../app/api-client";
import {
  useAddDeliveryUpdate, useAddMeasurement, useCreateKpi, useDelivery, useUpdateFinancials, useUpdatePilot,
} from "./api";

const link = ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
  <Link to={to} className={className}>{children}</Link>
);

const OUTCOME_LABEL: Record<PilotOutcome, string> = {
  SUCCEEDED: "Succeeded",
  MIXED: "Mixed results",
  DID_NOT_SUCCEED: "Did not succeed",
};
const NO_OUTCOME = "__none__";

const failed = (error: unknown) =>
  toast.error(error instanceof ApiError ? error.message : "That did not save. Try again.");

const dateOnly = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");
const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const fromDateInput = (v: string) => (v ? new Date(`${v}T12:00:00Z`).toISOString() : null);
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 3 });

function money(amount: number | null, currency: string): string {
  if (amount === null) return "—";
  try {
    return amount.toLocaleString(undefined, { style: "currency", currency });
  } catch {
    return `${amount.toLocaleString()} ${currency}`;
  }
}

/**
 * Delivery tab — P15 (prototype & pilot tracking) and P16 (KPIs, actual-vs-predicted,
 * ROI). Every figure here was entered by a person or is plain arithmetic on those
 * entries; nothing is estimated and none of it changes the composite score. Editing is
 * offered only when the server says so (`canWrite`, D-09): a reviewer or admin, on an
 * idea in a delivery stage that they did not submit.
 */
export function DeliveryTab() {
  const { ideaId = "" } = useParams();
  const query = useDelivery(ideaId);
  return (
    <IdeaShell>
      {() => {
        if (query.isPending) return <Skeleton className="h-64 w-full" />;
        if (query.isError) {
          return (
            <ErrorState
              title="Could not load delivery tracking"
              description="The idea itself is fine — this tab failed to load."
              onRetry={() => void query.refetch()}
              escapeTo={{ label: "Back to the overview", to: `/ideas/${ideaId}/overview` }}
              renderLink={link}
            />
          );
        }
        const d = query.data;
        if (!d.inDeliveryStage && !d.pilot && d.kpis.length === 0 && !d.financials && d.updates.length === 0) {
          return (
            <Card>
              <CardContent className="py-8 text-center">
                <p className="text-300 font-semibold">Nothing to track yet</p>
                <p className="mx-auto mt-2 max-w-prose text-200 text-muted-foreground">
                  Delivery tracking starts once a reviewer makes this idea a prototype candidate.
                  It is {STATUS_LABEL[d.status].toLowerCase()} right now.
                </p>
              </CardContent>
            </Card>
          );
        }
        return (
          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <PilotCard ideaId={ideaId} data={d} />
            <FinancialsCard ideaId={ideaId} data={d} />
            <div className="lg:col-span-2">
              <KpisCard ideaId={ideaId} data={d} />
            </div>
            <div className="lg:col-span-2">
              <ProgressCard ideaId={ideaId} data={d} />
            </div>
          </div>
        );
      }}
    </IdeaShell>
  );
}

/* ── Pilot (P15) ── */

function PilotCard({ ideaId, data }: { ideaId: string; data: IdeaDeliveryResponse }) {
  const pilot = data.pilot;
  const [editing, setEditing] = React.useState(false);
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2"><FlaskConical aria-hidden className="size-4" />Pilot</CardTitle>
          <p className="mt-1 text-200 text-muted-foreground">
            Dates are set automatically when the idea enters and leaves the Pilot stage.
          </p>
        </div>
        {data.canWrite && !editing ? <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Edit</Button> : null}
      </CardHeader>
      <CardContent>
        {editing ? (
          <PilotForm ideaId={ideaId} data={data} onDone={() => setEditing(false)} />
        ) : pilot ? (
          <dl className="grid gap-3 text-200 sm:grid-cols-2">
            <div><dt className="text-muted-foreground">Started</dt><dd className="font-medium">{dateOnly(pilot.startedAt)}</dd></div>
            <div><dt className="text-muted-foreground">Ended</dt><dd className="font-medium">{pilot.endedAt ? dateOnly(pilot.endedAt) : pilot.startedAt ? "Still running" : "—"}</dd></div>
            <div className="sm:col-span-2"><dt className="text-muted-foreground">Scope</dt><dd>{pilot.scope ?? "Not recorded"}</dd></div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Outcome</dt>
              <dd>
                {pilot.outcome ? <Badge variant="outline">{OUTCOME_LABEL[pilot.outcome]}</Badge> : "Not recorded yet"}
                {pilot.outcomeNotes ? <p className="mt-1">{pilot.outcomeNotes}</p> : null}
              </dd>
            </div>
            {pilot.updatedBy ? (
              <p className="text-100 text-muted-foreground sm:col-span-2">Last updated by {pilot.updatedBy.displayName}</p>
            ) : null}
          </dl>
        ) : (
          <p className="text-200 text-muted-foreground">No pilot has started. It begins when a reviewer moves the idea to Pilot.</p>
        )}
      </CardContent>
    </Card>
  );
}

function PilotForm({ ideaId, data, onDone }: { ideaId: string; data: IdeaDeliveryResponse; onDone: () => void }) {
  const save = useUpdatePilot(ideaId);
  const p = data.pilot;
  const [scope, setScope] = React.useState(p?.scope ?? "");
  const [outcome, setOutcome] = React.useState<string>(p?.outcome ?? NO_OUTCOME);
  const [notes, setNotes] = React.useState(p?.outcomeNotes ?? "");
  const [started, setStarted] = React.useState(toDateInput(p?.startedAt ?? null));
  const [ended, setEnded] = React.useState(toDateInput(p?.endedAt ?? null));
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(
          {
            scope, outcomeNotes: notes,
            outcome: outcome === NO_OUTCOME ? null : (outcome as PilotOutcome),
            startedAt: fromDateInput(started), endedAt: fromDateInput(ended),
          },
          { onSuccess: () => { toast.success("Pilot record saved"); onDone(); }, onError: failed },
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5"><Label htmlFor="pilot-start">Started</Label><Input id="pilot-start" type="date" value={started} onChange={(e) => setStarted(e.target.value)} /></div>
        <div className="grid gap-1.5"><Label htmlFor="pilot-end">Ended</Label><Input id="pilot-end" type="date" value={ended} onChange={(e) => setEnded(e.target.value)} /></div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="pilot-scope">Scope</Label>
        <Textarea id="pilot-scope" value={scope} onChange={(e) => setScope(e.target.value)} placeholder="Who and where the pilot runs — e.g. the Finance team's three London offices" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="pilot-outcome">Outcome</Label>
        <Select value={outcome} onValueChange={setOutcome}>
          <SelectTrigger id="pilot-outcome"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_OUTCOME}>Not recorded yet</SelectItem>
            {(Object.keys(OUTCOME_LABEL) as PilotOutcome[]).map((o) => (
              <SelectItem key={o} value={o}>{OUTCOME_LABEL[o]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="pilot-notes">What happened</Label>
        <Textarea id="pilot-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending}>Save</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

/* ── ROI inputs (P16) ── */

function FinancialsCard({ ideaId, data }: { ideaId: string; data: IdeaDeliveryResponse }) {
  const f = data.financials;
  const [editing, setEditing] = React.useState(false);
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2"><Coins aria-hidden className="size-4" />Return on investment</CardTitle>
          <p className="mt-1 text-200 text-muted-foreground">
            Both figures are entered by a person. ROI is (benefit − investment) ÷ investment — never estimated.
          </p>
        </div>
        {data.canWrite && !editing ? <Button variant="outline" size="sm" onClick={() => setEditing(true)}>{f ? "Edit" : "Enter figures"}</Button> : null}
      </CardHeader>
      <CardContent>
        {editing ? (
          <FinancialsForm ideaId={ideaId} data={data} onDone={() => setEditing(false)} />
        ) : f ? (
          <div className="grid gap-4">
            <div className="grid grid-cols-3 gap-3">
              <div><p className="text-100 text-muted-foreground">Investment to date</p><p className="text-300 font-semibold tabular-nums">{money(f.investmentToDate, f.currency)}</p></div>
              <div><p className="text-100 text-muted-foreground">Realized benefit</p><p className="text-300 font-semibold tabular-nums">{money(f.realizedBenefit, f.currency)}</p></div>
              <div>
                <p className="text-100 text-muted-foreground">ROI</p>
                <p className="text-300 font-semibold tabular-nums">
                  {f.roi === null ? "—" : `${f.roi > 0 ? "+" : ""}${(f.roi * 100).toFixed(1)}%`}
                </p>
              </div>
            </div>
            {f.roi === null ? (
              <p className="text-100 text-muted-foreground">ROI appears once both figures are entered and the investment is above zero.</p>
            ) : null}
            {f.basisNote ? <p className="text-200"><span className="text-muted-foreground">Basis: </span>{f.basisNote}</p> : null}
            {f.updatedBy ? <p className="text-100 text-muted-foreground">Entered by {f.updatedBy.displayName}</p> : null}
          </div>
        ) : (
          <p className="text-200 text-muted-foreground">No figures entered yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

function FinancialsForm({ ideaId, data, onDone }: { ideaId: string; data: IdeaDeliveryResponse; onDone: () => void }) {
  const save = useUpdateFinancials(ideaId);
  const f = data.financials;
  const [currency, setCurrency] = React.useState(f?.currency ?? "");
  const [investment, setInvestment] = React.useState(f?.investmentToDate?.toString() ?? "");
  const [benefit, setBenefit] = React.useState(f?.realizedBenefit?.toString() ?? "");
  const [basis, setBasis] = React.useState(f?.basisNote ?? "");
  const amount = (v: string) => (v.trim() === "" ? null : Number(v));
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(
          { currency, investmentToDate: amount(investment), realizedBenefit: amount(benefit), basisNote: basis },
          { onSuccess: () => { toast.success("Figures saved"); onDone(); }, onError: failed },
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor="fin-currency">Currency</Label>
          <Input id="fin-currency" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} placeholder="e.g. USD" required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="fin-investment">Investment to date</Label>
          <Input id="fin-investment" type="number" min="0" step="0.01" inputMode="decimal" value={investment} onChange={(e) => setInvestment(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="fin-benefit">Realized benefit</Label>
          <Input id="fin-benefit" type="number" min="0" step="0.01" inputMode="decimal" value={benefit} onChange={(e) => setBenefit(e.target.value)} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="fin-basis">What the benefit covers</Label>
        <Input id="fin-basis" value={basis} onChange={(e) => setBasis(e.target.value)} placeholder="e.g. hours saved in the first 12 months, at the finance team's costed rate" />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending}>Save</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

/* ── KPIs, actual vs predicted (P16) ── */

const STANDING_LABEL = { AHEAD: "Ahead of prediction", ON_PREDICTION: "On prediction", BEHIND: "Behind prediction" } as const;

function Trend({ kpi }: { kpi: KpiView }) {
  const values = kpi.measurements.map((m) => m.actualValue);
  if (values.length < 2) return null;
  const w = 120;
  const h = 32;
  const refs = kpi.predictedValue === null ? values : [...values, kpi.predictedValue];
  const min = Math.min(...refs);
  const max = Math.max(...refs);
  const range = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * (w - 4) + 2;
  const y = (v: number) => h - 2 - ((v - min) / range) * (h - 4);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-8 w-28" role="img" aria-label={`${kpi.name} measurements over time: ${values.map(fmt).join(", ")}`}>
      {kpi.predictedValue !== null ? (
        <line x1="0" x2={w} y1={y(kpi.predictedValue)} y2={y(kpi.predictedValue)} className="stroke-border" strokeDasharray="3 3" />
      ) : null}
      <polyline points={values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} fill="none" className="stroke-accent-600" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function KpisCard({ ideaId, data }: { ideaId: string; data: IdeaDeliveryResponse }) {
  const [adding, setAdding] = React.useState(false);
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2"><Gauge aria-hidden className="size-4" />KPIs</CardTitle>
          <p className="mt-1 text-200 text-muted-foreground">
            What this idea was expected to change, and what was measured. The dashed line on each trend is the prediction.
          </p>
        </div>
        {data.canWrite && !adding ? <Button variant="outline" size="sm" onClick={() => setAdding(true)}>Add a KPI</Button> : null}
      </CardHeader>
      <CardContent className="grid gap-4">
        {adding ? <KpiForm ideaId={ideaId} onDone={() => setAdding(false)} /> : null}
        {data.kpis.length === 0 && !adding ? (
          <p className="text-200 text-muted-foreground">No KPIs defined yet.</p>
        ) : null}
        {data.kpis.map((k) => <KpiRow key={k.id} ideaId={ideaId} kpi={k} canWrite={data.canWrite} />)}
      </CardContent>
    </Card>
  );
}

function KpiRow({ ideaId, kpi, canWrite }: { ideaId: string; kpi: KpiView; canWrite: boolean }) {
  const latest = kpi.measurements.at(-1);
  const [measuring, setMeasuring] = React.useState(false);
  const vs = kpi.versusPredicted;
  return (
    <section className="rounded-lg border border-border p-4" aria-label={kpi.name}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-300 font-semibold">{kpi.name} <span className="text-200 font-normal text-muted-foreground">({kpi.unit})</span></h3>
          {kpi.description ? <p className="text-200 text-muted-foreground">{kpi.description}</p> : null}
          <p className="text-100 text-muted-foreground">{kpi.direction === "HIGHER_IS_BETTER" ? "Higher is better" : "Lower is better"}</p>
        </div>
        <Trend kpi={kpi} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-200 sm:grid-cols-4">
        <div><dt className="text-muted-foreground">Target</dt><dd className="font-medium tabular-nums">{kpi.targetValue === null ? "—" : fmt(kpi.targetValue)}</dd></div>
        <div><dt className="text-muted-foreground">Predicted</dt><dd className="font-medium tabular-nums">{kpi.predictedValue === null ? "—" : fmt(kpi.predictedValue)}</dd></div>
        <div>
          <dt className="text-muted-foreground">Latest actual</dt>
          <dd className="font-medium tabular-nums">{latest ? `${fmt(latest.actualValue)}` : "—"}</dd>
          {latest ? <dd className="text-100 text-muted-foreground">{dateOnly(latest.measuredAt)}</dd> : null}
        </div>
        <div>
          <dt className="text-muted-foreground">Versus prediction</dt>
          <dd>
            {vs ? (
              <>
                <Badge variant="outline">{STANDING_LABEL[vs.standing]}</Badge>
                <span className="mt-0.5 block text-100 tabular-nums text-muted-foreground">
                  {vs.difference > 0 ? "+" : ""}{fmt(vs.difference)}{vs.percent === null ? "" : ` (${vs.percent > 0 ? "+" : ""}${vs.percent}%)`}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">Needs a prediction and a measurement</span>
            )}
          </dd>
        </div>
      </dl>
      {canWrite ? (
        measuring ? (
          <MeasurementForm ideaId={ideaId} kpi={kpi} onDone={() => setMeasuring(false)} />
        ) : (
          <Button className="mt-3" variant="ghost" size="sm" onClick={() => setMeasuring(true)}>Record a measurement</Button>
        )
      ) : null}
    </section>
  );
}

function KpiForm({ ideaId, onDone }: { ideaId: string; onDone: () => void }) {
  const create = useCreateKpi(ideaId);
  const [name, setName] = React.useState("");
  const [unit, setUnit] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [direction, setDirection] = React.useState<"HIGHER_IS_BETTER" | "LOWER_IS_BETTER">("HIGHER_IS_BETTER");
  const [target, setTarget] = React.useState("");
  const [predicted, setPredicted] = React.useState("");
  const value = (v: string) => (v.trim() === "" ? null : Number(v));
  return (
    <form
      className="grid gap-3 rounded-lg border border-border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate(
          { name, unit, description, direction, targetValue: value(target), predictedValue: value(predicted) },
          { onSuccess: () => { toast.success("KPI added"); onDone(); }, onError: failed },
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5"><Label htmlFor="kpi-name">Name</Label><Input id="kpi-name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Minutes to file an expense claim" /></div>
        <div className="grid gap-1.5"><Label htmlFor="kpi-unit">Unit</Label><Input id="kpi-unit" value={unit} onChange={(e) => setUnit(e.target.value)} required placeholder="e.g. minutes" /></div>
      </div>
      <div className="grid gap-1.5"><Label htmlFor="kpi-description">What it measures</Label><Input id="kpi-description" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor="kpi-direction">Better is</Label>
          <Select value={direction} onValueChange={(v) => setDirection(v as typeof direction)}>
            <SelectTrigger id="kpi-direction"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="HIGHER_IS_BETTER">Higher</SelectItem>
              <SelectItem value="LOWER_IS_BETTER">Lower</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5"><Label htmlFor="kpi-target">Target</Label><Input id="kpi-target" type="number" step="any" value={target} onChange={(e) => setTarget(e.target.value)} /></div>
        <div className="grid gap-1.5"><Label htmlFor="kpi-predicted">Predicted</Label><Input id="kpi-predicted" type="number" step="any" value={predicted} onChange={(e) => setPredicted(e.target.value)} /></div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={create.isPending}>Add KPI</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

function MeasurementForm({ ideaId, kpi, onDone }: { ideaId: string; kpi: KpiView; onDone: () => void }) {
  const add = useAddMeasurement(ideaId);
  const [actual, setActual] = React.useState("");
  const [date, setDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = React.useState("");
  const idBase = `m-${kpi.id}`;
  return (
    <form
      className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        const measuredAt = fromDateInput(date);
        if (!measuredAt || actual.trim() === "") return;
        add.mutate(
          { kpiId: kpi.id, body: { actualValue: Number(actual), measuredAt, note } },
          { onSuccess: () => { toast.success("Measurement recorded"); onDone(); }, onError: failed },
        );
      }}
    >
      <div className="grid gap-1.5"><Label htmlFor={`${idBase}-value`}>Actual ({kpi.unit})</Label><Input id={`${idBase}-value`} type="number" step="any" value={actual} onChange={(e) => setActual(e.target.value)} required /></div>
      <div className="grid gap-1.5"><Label htmlFor={`${idBase}-date`}>Measured on</Label><Input id={`${idBase}-date`} type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} required /></div>
      <div className="grid gap-1.5"><Label htmlFor={`${idBase}-note`}>Note</Label><Input id={`${idBase}-note`} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <div className="flex gap-2">
        <Button type="submit" disabled={add.isPending}>Save</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

/* ── Progress timeline (P15) ── */

function ProgressCard({ ideaId, data }: { ideaId: string; data: IdeaDeliveryResponse }) {
  const add = useAddDeliveryUpdate(ideaId);
  const [note, setNote] = React.useState("");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ClipboardList aria-hidden className="size-4" />Progress</CardTitle>
        <p className="text-200 text-muted-foreground">Dated notes on how the prototype or pilot is going, newest first.</p>
      </CardHeader>
      <CardContent className="grid gap-4">
        {data.canWrite ? (
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate({ note }, { onSuccess: () => { setNote(""); toast.success("Progress noted"); }, onError: failed });
            }}
          >
            <Label htmlFor="progress-note">Add a progress note</Label>
            <Textarea id="progress-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed since the last note?" />
            <div><Button type="submit" disabled={add.isPending || note.trim() === ""}>Add note</Button></div>
          </form>
        ) : null}
        {data.updates.length === 0 ? (
          <p className="text-200 text-muted-foreground">No progress notes yet.</p>
        ) : (
          <ol className="grid gap-3">
            {data.updates.map((u) => (
              <li key={u.id} className="border-l-2 border-accent-100 pl-3">
                <p className="text-100 text-muted-foreground">
                  {new Date(u.createdAt).toLocaleString()} · {u.author.displayName} · during {STATUS_LABEL[u.stage]}
                </p>
                <p className="mt-0.5 whitespace-pre-line text-200">{u.note}</p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
