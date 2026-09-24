import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Layers, Radar, Tags } from "lucide-react";
import {
  Badge, Button, Card, CardContent, CardHeader, CardTitle, ErrorState, Input, Label,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, Switch,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Textarea,
} from "@iep/ui";
import type {
  DepartmentListResponse, DetectionConfigResponse, ExistingSolutionKind,
  ListCategoriesResponse, ListExistingSolutionsResponse,
} from "@iep/contracts";
import { ApiError, api } from "../../app/api-client";
import { queryKeys } from "../../app/query-keys";
import { PageHeading } from "../../app/PageHero";
import {
  useCreateCategory, useCreateExistingSolution, useUpdateCategory, useUpdateDetectionConfig,
  useUpdateExistingSolution,
} from "./api";

const link = ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
  <Link to={to} className={className}>{children}</Link>
);

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Could not reach the server. Nothing was changed.";
}

/**
 * P10 — categories write UI.
 *
 * No delete: a category may already sit on a submitted idea (`ideaCount` shows exactly
 * that), so the write surface is rename + deactivate, the same "structural once used"
 * treatment `EvaluationCriterion` already gets — never a hard delete.
 */
export function CategoriesPage() {
  const query = useQuery({
    queryKey: queryKeys.config.categories(),
    queryFn: () => api<ListCategoriesResponse>("/config/categories"),
    staleTime: 60_000,
  });
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const [newKey, setNewKey] = React.useState("");
  const [newLabel, setNewLabel] = React.useState("");
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editingLabel, setEditingLabel] = React.useState("");

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link to="/admin/users">Administration</Link>  ›  Categories
      </nav>
      <PageHeading
        icon={Tags}
        heading="Idea categories"
        description="What an idea is filed under — shown on every idea card and used to filter the board. Renaming one is safe; deactivating one hides it from new submissions without touching the ideas that already carry it."
      />

      {query.isPending ? (
        <Skeleton className="mt-6 h-64 w-full" aria-busy="true" />
      ) : query.isError ? (
        <ErrorState
          title="Could not load categories"
          description="Nothing else on the page is affected — this is the reference page failing to load."
          onRetry={() => void query.refetch()}
          escapeTo={{ label: "Back to ideas", to: "/ideas" }} renderLink={link}
        />
      ) : (
        <div className="mt-6 space-y-6">
          <Card>
            <CardContent className="overflow-x-auto pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Key</TableHead>
                    <TableHead>Label</TableHead>
                    <TableHead>Ideas using it</TableHead>
                    <TableHead>Active</TableHead>
                    {query.data.canWrite ? <TableHead className="w-24">&nbsp;</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.items.map((c) => {
                    const isEditing = editingId === c.id;
                    return (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono text-100">{c.key}</TableCell>
                        <TableCell>
                          {isEditing ? (
                            <Input
                              value={editingLabel}
                              onChange={(e) => setEditingLabel(e.target.value)}
                              aria-label={`Label for ${c.key}`}
                            />
                          ) : (
                            c.label
                          )}
                        </TableCell>
                        <TableCell className="tabular-nums">{c.ideaCount}</TableCell>
                        <TableCell>
                          {query.data.canWrite ? (
                            <Switch
                              checked={c.isActive}
                              aria-label={`${c.label} active`}
                              onCheckedChange={(checked) =>
                                update.mutate({ categoryId: c.id, isActive: checked })
                              }
                            />
                          ) : (
                            <Badge variant={c.isActive ? "default" : "outline"}>
                              {c.isActive ? "Active" : "Inactive"}
                            </Badge>
                          )}
                        </TableCell>
                        {query.data.canWrite ? (
                          <TableCell>
                            {isEditing ? (
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  disabled={update.isPending || editingLabel.trim().length === 0}
                                  onClick={() =>
                                    update.mutate(
                                      { categoryId: c.id, label: editingLabel.trim() },
                                      { onSuccess: () => setEditingId(null) },
                                    )
                                  }
                                >
                                  Save
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <Button
                                size="sm" variant="outline"
                                onClick={() => { setEditingId(c.id); setEditingLabel(c.label); }}
                              >
                                Rename
                              </Button>
                            )}
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {query.data.canWrite ? (
            <Card>
              <CardHeader><CardTitle>Add a category</CardTitle></CardHeader>
              <CardContent>
                <form
                  className="flex flex-wrap items-end gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    create.mutate(
                      { key: newKey.trim(), label: newLabel.trim() },
                      { onSuccess: () => { setNewKey(""); setNewLabel(""); } },
                    );
                  }}
                >
                  <div>
                    <Label htmlFor="field-newCategoryKey">Key (lowercase, no spaces)</Label>
                    <Input
                      id="field-newCategoryKey" value={newKey}
                      onChange={(e) => setNewKey(e.target.value)} placeholder="cost_reduction"
                    />
                  </div>
                  <div>
                    <Label htmlFor="field-newCategoryLabel">Label</Label>
                    <Input
                      id="field-newCategoryLabel" value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)} placeholder="Cost reduction"
                    />
                  </div>
                  <Button type="submit" disabled={create.isPending || !newKey.trim() || !newLabel.trim()}>
                    {create.isPending ? "Adding…" : "Add category"}
                  </Button>
                </form>
                {create.isError ? (
                  <p role="alert" className="mt-2 text-100 text-destructive">{errorMessage(create.error)}</p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </main>
  );
}

const KIND_LABEL: Record<ExistingSolutionKind, string> = {
  INTERNAL_SYSTEM: "Internal system",
  APPROVED_VENDOR: "Approved vendor",
  PLATFORM_CAPABILITY: "Platform capability",
};

function useDepartmentOptions() {
  return useQuery({
    queryKey: queryKeys.admin.departments(),
    queryFn: () => api<DepartmentListResponse>("/admin/departments"),
    staleTime: 5 * 60_000,
  });
}

/**
 * P10 — the existing-solution capability catalogue (P12/AI-11's prerequisite).
 *
 * What an admin curates here is the PRIMARY source FR-21 searches against (SPEC §12.3
 * AI-11) — no external connector is on the critical path (the P12 risk note). An entry's
 * embedding is computed worker-side, opportunistically, the next time any idea runs
 * through detection (SPEC §4.4 keeps the provider call off this process) — `hasEmbedding`
 * says whether that has happened yet, not whether the entry itself is valid.
 */
export function ExistingSolutionsPage() {
  const query = useQuery({
    queryKey: queryKeys.config.existingSolutions(),
    queryFn: () => api<ListExistingSolutionsResponse>("/config/existing-solutions"),
    staleTime: 60_000,
  });
  const departments = useDepartmentOptions();
  const create = useCreateExistingSolution();
  const update = useUpdateExistingSolution();

  const [form, setForm] = React.useState({
    name: "", kind: "INTERNAL_SYSTEM" as ExistingSolutionKind, description: "",
    categories: "", ownerDepartmentId: "",
  });

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link to="/admin/users">Administration</Link>  ›  Existing-solution catalogue
      </nav>
      <PageHeading
        icon={Layers}
        heading="Existing-solution catalogue"
        description="Internal systems, approved vendors and platform capabilities an idea might already be solved by. AI-11 searches this list before recommending build, buy, extend or integrate — a curated entry here is a better source for that call than a wiki search hit."
      />

      {query.isPending || departments.isPending ? (
        <Skeleton className="mt-6 h-64 w-full" aria-busy="true" />
      ) : query.isError ? (
        <ErrorState
          title="Could not load the catalogue"
          description="Nothing else on the page is affected — this is the reference page failing to load."
          onRetry={() => void query.refetch()}
          escapeTo={{ label: "Back to ideas", to: "/ideas" }} renderLink={link}
        />
      ) : (
        <div className="mt-6 space-y-6">
          <Card>
            <CardContent className="overflow-x-auto pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Categories</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Embedded</TableHead>
                    <TableHead>Active</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.items.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <div className="font-medium">{s.name}</div>
                        <div className="text-100 text-muted-foreground">{s.description}</div>
                      </TableCell>
                      <TableCell>{KIND_LABEL[s.kind]}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {s.categories.map((c) => <Badge key={c} variant="outline">{c}</Badge>)}
                        </div>
                      </TableCell>
                      <TableCell>{s.ownerDepartment?.name ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={s.hasEmbedding ? "default" : "outline"}>
                          {s.hasEmbedding ? "Yes" : "Pending"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {query.data.canWrite ? (
                          <Switch
                            checked={s.isActive}
                            aria-label={`${s.name} active`}
                            onCheckedChange={(checked) => update.mutate({ solutionId: s.id, isActive: checked })}
                          />
                        ) : (
                          <Badge variant={s.isActive ? "default" : "outline"}>
                            {s.isActive ? "Active" : "Inactive"}
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {query.data.canWrite ? (
            <Card>
              <CardHeader><CardTitle>Add a catalogue entry</CardTitle></CardHeader>
              <CardContent>
                <form
                  className="grid gap-3 sm:grid-cols-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    create.mutate(
                      {
                        name: form.name.trim(), kind: form.kind, description: form.description.trim(),
                        ownerDepartmentId: form.ownerDepartmentId || null,
                        categories: form.categories.split(",").map((c) => c.trim()).filter(Boolean),
                      },
                      {
                        onSuccess: () =>
                          setForm({ name: "", kind: "INTERNAL_SYSTEM", description: "", categories: "", ownerDepartmentId: "" }),
                      },
                    );
                  }}
                >
                  <div>
                    <Label htmlFor="field-solutionName">Name</Label>
                    <Input
                      id="field-solutionName" value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="field-solutionKind">Kind</Label>
                    <Select
                      value={form.kind}
                      onValueChange={(v) => setForm((f) => ({ ...f, kind: v as ExistingSolutionKind }))}
                    >
                      <SelectTrigger id="field-solutionKind"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(KIND_LABEL) as ExistingSolutionKind[]).map((k) => (
                          <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="field-solutionDescription">Description</Label>
                    <Textarea
                      id="field-solutionDescription" value={form.description}
                      onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                      placeholder="What it does today, and what it would take to extend it."
                    />
                  </div>
                  <div>
                    <Label htmlFor="field-solutionCategories">Categories (comma-separated)</Label>
                    <Input
                      id="field-solutionCategories" value={form.categories}
                      onChange={(e) => setForm((f) => ({ ...f, categories: e.target.value }))}
                      placeholder="cost_reduction, automation"
                    />
                  </div>
                  <div>
                    <Label htmlFor="field-solutionOwner">Owning department</Label>
                    <Select
                      value={form.ownerDepartmentId || "__none__"}
                      onValueChange={(v) => setForm((f) => ({ ...f, ownerDepartmentId: v === "__none__" ? "" : v }))}
                    >
                      <SelectTrigger id="field-solutionOwner"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {(departments.data?.items ?? []).map((d) => (
                          <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="sm:col-span-2">
                    <Button
                      type="submit"
                      disabled={create.isPending || !form.name.trim() || !form.description.trim()}
                    >
                      {create.isPending ? "Adding…" : "Add entry"}
                    </Button>
                  </div>
                </form>
                {create.isError ? (
                  <p role="alert" className="mt-2 text-100 text-destructive">{errorMessage(create.error)}</p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </main>
  );
}

/** Mounted only once `query.data` exists (see `DetectionConfigPage` below) — lazy
 *  `useState` init from real data, same pattern `ProfileWeightsEditor` already uses,
 *  rather than an effect that sets state after the fact. */
function DetectionConfigForm({ config }: { config: DetectionConfigResponse }) {
  const update = useUpdateDetectionConfig();
  const [form, setForm] = React.useState({
    similarIdea: (config.similarIdeaThreshold * 100).toFixed(0),
    existingSolution: (config.existingSolutionThreshold * 100).toFixed(0),
    topN: String(config.existingSolutionTopN),
  });

  return (
    <Card className="mt-6 max-w-xl">
      <CardContent className="pt-6">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({
              similarIdeaThreshold: (Number(form.similarIdea) || 0) / 100,
              existingSolutionThreshold: (Number(form.existingSolution) || 0) / 100,
              existingSolutionTopN: Math.round(Number(form.topN) || 1),
            });
          }}
        >
          <div>
            <Label htmlFor="field-similarIdeaThreshold">Similar-idea match cutoff (%)</Label>
            <Input
              id="field-similarIdeaThreshold" type="number" min={0} max={100} step={1}
              value={form.similarIdea} disabled={!config.canWrite}
              onChange={(e) => setForm({ ...form, similarIdea: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="field-existingSolutionThreshold">Existing-solution match cutoff (%)</Label>
            <Input
              id="field-existingSolutionThreshold" type="number" min={0} max={100} step={1}
              value={form.existingSolution} disabled={!config.canWrite}
              onChange={(e) => setForm({ ...form, existingSolution: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="field-existingSolutionTopN">Catalogue matches considered per idea</Label>
            <Input
              id="field-existingSolutionTopN" type="number" min={1} max={20} step={1}
              value={form.topN} disabled={!config.canWrite}
              onChange={(e) => setForm({ ...form, topN: e.target.value })}
            />
          </div>

          {update.isError ? (
            <p role="alert" className="text-100 text-destructive">{errorMessage(update.error)}</p>
          ) : null}

          {config.canWrite ? (
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? "Saving…" : "Save thresholds"}
            </Button>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

/** P12 — the two match cutoffs, admin-editable rather than a code literal (same
 *  "configurable, not a fixed business number" reasoning as `ProfileWeightsEditor`). */
export function DetectionConfigPage() {
  const query = useQuery({
    queryKey: queryKeys.config.detection(),
    queryFn: () => api<DetectionConfigResponse>("/config/detection"),
    staleTime: 60_000,
  });

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link to="/admin/users">Administration</Link>  ›  Detection thresholds
      </nav>
      <PageHeading
        icon={Radar}
        heading="Detection thresholds"
        description="How closely two ideas must match before a submitter sees “We found a similar idea” (AI-10), and how many catalogue entries feed AI-11's build/buy/extend/integrate call. Both are starting points, not fixed rules — retune them once reviewers see real matches."
      />

      {query.isPending ? (
        <Skeleton className="mt-6 h-48 w-full" aria-busy="true" />
      ) : query.isError ? (
        <ErrorState
          title="Could not load detection thresholds"
          description="Nothing else on the page is affected — this is the reference page failing to load."
          onRetry={() => void query.refetch()}
          escapeTo={{ label: "Back to ideas", to: "/ideas" }} renderLink={link}
        />
      ) : (
        <DetectionConfigForm config={query.data} />
      )}
    </main>
  );
}
