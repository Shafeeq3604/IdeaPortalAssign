import {
  AddDeliveryUpdateRequest, AddKpiMeasurementRequest, CreateKpiRequest, DELIVERY_STAGES, PilotOutcome,
  UpdateFinancialsRequest, UpdateKpiRequest, UpdatePilotRequest, can, hasAllPermissions,
} from "@iep/contracts";
import type { ActorRef, IdeaDeliveryResponse, IdeaStatus, NotificationPayload } from "@iep/contracts";
import type { Prisma, PrismaClient } from "@iep/db";
import type { Handler } from "../../server.js";
import { requireActor, sendError } from "../../server.js";
import { writeAudit, type AuditAction } from "../../lib/audit.js";
import { ideaTeamIds, recordIdeaNotification, recordPeopleNotifications } from "@iep/evaluation";
import { computeRoi, versusPredicted } from "./present.js";

/**
 * Delivery tracking — P15 (prototype & pilot) and P16 (KPIs, actual-vs-predicted, ROI).
 *
 * READ: anyone who can read the idea (same guard as every idea-scoped route).
 * WRITE: `idea:transition` holders — the reviewers/admins who move ideas through these
 * stages — while the idea is in a delivery stage, and never on an idea they submitted
 * themselves: a pilot outcome or an ROI figure is a judgement about the idea, and SPEC
 * §4.2 keeps judging your own idea out of your hands (the same rule reviews follow).
 * Every write is audited against the idea, in the same transaction.
 *
 * The pilot record's DATES are also kept by the lifecycle itself: entering PILOT stamps
 * `started_at`, leaving it stamps `ended_at` (idea/repo.ts `transition`). This module
 * lets a person correct them and record scope and outcome.
 */

const NOT_FOUND = "No idea with that id";
const NOT_IN_DELIVERY =
  "Delivery details can be recorded once an idea is a prototype candidate or further along.";
const OWN_IDEA = "You cannot record delivery results on an idea you submitted. Another reviewer has to.";

const isDeliveryStage = (s: IdeaStatus) => (DELIVERY_STAGES as readonly IdeaStatus[]).includes(s);

type Req = Parameters<Handler>[0];
type Ctx = Parameters<Handler>[2];

async function readableIdea(request: Req, ctx: Ctx, ideaId: string) {
  const idea = await ctx.db.idea.findUnique({
    where: { id: ideaId }, select: { id: true, submitterId: true, status: true },
  });
  if (!idea) return null;
  const allowed = can(requireActor(request), "idea:read", {
    ideaId: idea.id, submitterId: idea.submitterId, status: idea.status as IdeaStatus,
  }).allowed;
  return allowed ? idea : null;
}

function canWriteDelivery(request: Req, idea: { submitterId: string; status: string }): boolean {
  const actor = requireActor(request);
  return (
    hasAllPermissions(actor.roles, ["idea:transition"]) &&
    actor.userId !== idea.submitterId &&
    isDeliveryStage(idea.status as IdeaStatus)
  );
}

const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));

async function loadDelivery(db: PrismaClient, request: Req, ideaId: string): Promise<IdeaDeliveryResponse | null> {
  const idea = await db.idea.findUnique({
    where: { id: ideaId },
    select: {
      id: true, status: true, submitterId: true,
      pilotRecord: true,
      deliveryUpdates: { orderBy: { createdAt: "desc" } },
      kpiDefinitions: {
        orderBy: { createdAt: "asc" },
        include: { measurements: { orderBy: { measuredAt: "asc" } } },
      },
      financials: true,
    },
  });
  if (!idea) return null;

  // The M3 tables carry plain user-id columns, so actors are resolved in one batch.
  const ids = new Set<string>();
  if (idea.pilotRecord?.updatedById) ids.add(idea.pilotRecord.updatedById);
  for (const u of idea.deliveryUpdates) ids.add(u.authorId);
  for (const k of idea.kpiDefinitions) for (const m of k.measurements) if (m.recordedById) ids.add(m.recordedById);
  if (idea.financials) ids.add(idea.financials.updatedById);
  const users = await db.user.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, displayName: true, department: { select: { name: true } } },
  });
  const byId = new Map<string, ActorRef>(
    users.map((u) => [u.id, { id: u.id, displayName: u.displayName, departmentName: u.department?.name ?? null }]),
  );
  const actor = (id: string | null): ActorRef | null => (id ? (byId.get(id) ?? null) : null);
  const unknownActor = (id: string): ActorRef => byId.get(id) ?? { id, displayName: "Former user", departmentName: null };

  const status = idea.status as IdeaStatus;
  const pilot = idea.pilotRecord;
  const outcome = PilotOutcome.safeParse(pilot?.outcome);

  return {
    ideaId: idea.id,
    status,
    canWrite: canWriteDelivery(request, idea),
    inDeliveryStage: isDeliveryStage(status),
    pilot: pilot
      ? {
          startedAt: pilot.startedAt?.toISOString() ?? null,
          endedAt: pilot.endedAt?.toISOString() ?? null,
          scope: pilot.scope,
          outcome: outcome.success ? outcome.data : null,
          outcomeNotes: pilot.outcomeNotes,
          updatedBy: actor(pilot.updatedById),
          updatedAt: pilot.updatedAt.toISOString(),
        }
      : null,
    updates: idea.deliveryUpdates.map((u) => ({
      id: u.id, stage: u.stage as IdeaStatus, note: u.note,
      author: unknownActor(u.authorId), createdAt: u.createdAt.toISOString(),
    })),
    kpis: idea.kpiDefinitions.map((k) => {
      const latest = k.measurements.at(-1);
      return {
        id: k.id, name: k.name, unit: k.unit, description: k.description, direction: k.direction,
        targetValue: num(k.targetValue), predictedValue: num(k.predictedValue),
        measurements: k.measurements.map((m) => ({
          id: m.id, actualValue: Number(m.actualValue), measuredAt: m.measuredAt.toISOString(),
          note: m.note, recordedBy: actor(m.recordedById),
        })),
        versusPredicted: versusPredicted(num(k.predictedValue), latest ? Number(latest.actualValue) : null, k.direction),
        createdAt: k.createdAt.toISOString(),
      };
    }),
    financials: idea.financials
      ? {
          currency: idea.financials.currency,
          investmentToDate: num(idea.financials.investmentToDate),
          realizedBenefit: num(idea.financials.realizedBenefit),
          basisNote: idea.financials.basisNote,
          roi: computeRoi(num(idea.financials.investmentToDate), num(idea.financials.realizedBenefit)),
          updatedBy: actor(idea.financials.updatedById),
          updatedAt: idea.financials.updatedAt.toISOString(),
        }
      : null,
  };
}

/**
 * Shared write preamble: parse, find, authorise. Returns null after sending the error.
 * Order matters: an idea the actor cannot read is NOT_FOUND before anything else, so a
 * write endpoint never confirms that an invisible idea exists.
 */
async function guardWrite(request: Req, reply: Parameters<Handler>[1], ctx: Ctx) {
  const { ideaId } = request.params as { ideaId: string };
  const idea = await readableIdea(request, ctx, ideaId);
  if (!idea) {
    sendError(reply, "NOT_FOUND", NOT_FOUND);
    return null;
  }
  if (requireActor(request).userId === idea.submitterId) {
    sendError(reply, "FORBIDDEN", OWN_IDEA);
    return null;
  }
  if (!isDeliveryStage(idea.status as IdeaStatus)) {
    sendError(reply, "FORBIDDEN", NOT_IN_DELIVERY);
    return null;
  }
  return idea;
}

function audit(
  tx: Prisma.TransactionClient, request: Req, ideaId: string, action: AuditAction,
  after: Prisma.InputJsonValue, before?: Prisma.InputJsonValue,
) {
  return writeAudit(tx, {
    actorId: requireActor(request).userId, action, entityType: "idea", entityId: ideaId,
    before: before ?? null, after, reason: null, requestId: request.id,
  });
}

/**
 * "Your idea's results are in" — to the submitter (owner wording) and to the idea's team
 * (the people who said they could help build it), in the write's own transaction, never
 * to the person who recorded it. The same P13/P18 rules as every other notification:
 * recipients must still be able to open the idea, and email follows their opt-out.
 */
async function notifyResults(
  tx: Prisma.TransactionClient,
  request: Req,
  ideaId: string,
  facts: Omit<Extract<NotificationPayload, { event: "RESULTS_RECORDED" }>, "event" | "ideaTitle" | "actorName" | "audience">,
) {
  const actorId = requireActor(request).userId;
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { displayName: true } });
  const actorName = actor?.displayName ?? "A reviewer";
  const payload = (audience: "OWNER" | "TEAM") => (ideaTitle: string): NotificationPayload => ({
    event: "RESULTS_RECORDED", ideaTitle, actorName, audience, ...facts,
  });
  await recordIdeaNotification(tx, { ideaId, actorId, payload: payload("OWNER") });
  await recordPeopleNotifications(tx, {
    ideaId, actorId, recipientIds: await ideaTeamIds(tx, ideaId), payload: payload("TEAM"),
  });
}

export function registerDeliveryRoutes(handlers: Map<string, Handler>): void {
  handlers.set("getIdeaDelivery", async (request, reply, ctx) => {
    const { ideaId } = request.params as { ideaId: string };
    if (!(await readableIdea(request, ctx, ideaId))) return sendError(reply, "NOT_FOUND", NOT_FOUND);
    const body = await loadDelivery(ctx.db, request, ideaId);
    return body ?? sendError(reply, "NOT_FOUND", NOT_FOUND);
  });

  handlers.set("addDeliveryUpdate", async (request, reply, ctx) => {
    const parsed = AddDeliveryUpdateRequest.safeParse(request.body);
    if (!parsed.success) return sendError(reply, "VALIDATION_FAILED", parsed.error.issues[0]?.message ?? "Invalid note");
    const idea = await guardWrite(request, reply, ctx);
    if (!idea) return reply;
    await ctx.db.$transaction(async (tx) => {
      const update = await tx.deliveryUpdate.create({
        data: { ideaId: idea.id, stage: idea.status, note: parsed.data.note, authorId: requireActor(request).userId },
      });
      await audit(tx, request, idea.id, "delivery.update", { deliveryUpdateId: update.id, stage: idea.status });
    });
    return reply.status(201).send(await loadDelivery(ctx.db, request, idea.id));
  });

  handlers.set("updatePilotRecord", async (request, reply, ctx) => {
    const parsed = UpdatePilotRequest.safeParse(request.body);
    if (!parsed.success) return sendError(reply, "VALIDATION_FAILED", parsed.error.issues[0]?.message ?? "Invalid pilot record");
    const idea = await guardWrite(request, reply, ctx);
    if (!idea) return reply;
    const p = parsed.data;
    const data = {
      ...(p.scope !== undefined ? { scope: p.scope || null } : {}),
      ...(p.outcome !== undefined ? { outcome: p.outcome } : {}),
      ...(p.outcomeNotes !== undefined ? { outcomeNotes: p.outcomeNotes || null } : {}),
      ...(p.startedAt !== undefined ? { startedAt: p.startedAt ? new Date(p.startedAt) : null } : {}),
      ...(p.endedAt !== undefined ? { endedAt: p.endedAt ? new Date(p.endedAt) : null } : {}),
      updatedById: requireActor(request).userId,
    };
    await ctx.db.$transaction(async (tx) => {
      const before = await tx.pilotRecord.findUnique({ where: { ideaId: idea.id } });
      const saved = await tx.pilotRecord.upsert({
        where: { ideaId: idea.id }, create: { ideaId: idea.id, ...data }, update: data,
      });
      await audit(
        tx, request, idea.id, "delivery.pilot",
        { outcome: saved.outcome, scope: saved.scope, startedAt: saved.startedAt?.toISOString() ?? null, endedAt: saved.endedAt?.toISOString() ?? null },
        before ? { outcome: before.outcome, scope: before.scope } : undefined,
      );
    });
    return loadDelivery(ctx.db, request, idea.id);
  });

  handlers.set("createKpi", async (request, reply, ctx) => {
    const parsed = CreateKpiRequest.safeParse(request.body);
    if (!parsed.success) return sendError(reply, "VALIDATION_FAILED", parsed.error.issues[0]?.message ?? "Invalid KPI");
    const idea = await guardWrite(request, reply, ctx);
    if (!idea) return reply;
    const k = parsed.data;
    await ctx.db.$transaction(async (tx) => {
      const kpi = await tx.kpiDefinition.create({
        data: {
          ideaId: idea.id, name: k.name, unit: k.unit, description: k.description || null,
          direction: k.direction, targetValue: k.targetValue ?? null, predictedValue: k.predictedValue ?? null,
          createdById: requireActor(request).userId,
        },
      });
      await audit(tx, request, idea.id, "delivery.kpi", {
        kpiId: kpi.id, name: kpi.name, unit: kpi.unit,
        targetValue: k.targetValue ?? null, predictedValue: k.predictedValue ?? null,
      });
    });
    return reply.status(201).send(await loadDelivery(ctx.db, request, idea.id));
  });

  handlers.set("updateKpi", async (request, reply, ctx) => {
    const parsed = UpdateKpiRequest.safeParse(request.body);
    if (!parsed.success) return sendError(reply, "VALIDATION_FAILED", parsed.error.issues[0]?.message ?? "Invalid KPI");
    const idea = await guardWrite(request, reply, ctx);
    if (!idea) return reply;
    const { kpiId } = request.params as { kpiId: string };
    const existing = await ctx.db.kpiDefinition.findFirst({ where: { id: kpiId, ideaId: idea.id } });
    if (!existing) return sendError(reply, "NOT_FOUND", "No KPI with that id on this idea");
    const k = parsed.data;
    await ctx.db.$transaction(async (tx) => {
      const saved = await tx.kpiDefinition.update({
        where: { id: kpiId },
        data: {
          ...(k.name !== undefined ? { name: k.name } : {}),
          ...(k.unit !== undefined ? { unit: k.unit } : {}),
          ...(k.description !== undefined ? { description: k.description || null } : {}),
          ...(k.direction !== undefined ? { direction: k.direction } : {}),
          ...(k.targetValue !== undefined ? { targetValue: k.targetValue } : {}),
          ...(k.predictedValue !== undefined ? { predictedValue: k.predictedValue } : {}),
        },
      });
      await audit(
        tx, request, idea.id, "delivery.kpi",
        { kpiId, name: saved.name, targetValue: num(saved.targetValue), predictedValue: num(saved.predictedValue) },
        { name: existing.name, targetValue: num(existing.targetValue), predictedValue: num(existing.predictedValue) },
      );
    });
    return loadDelivery(ctx.db, request, idea.id);
  });

  handlers.set("addKpiMeasurement", async (request, reply, ctx) => {
    const parsed = AddKpiMeasurementRequest.safeParse(request.body);
    if (!parsed.success) return sendError(reply, "VALIDATION_FAILED", parsed.error.issues[0]?.message ?? "Invalid measurement");
    const idea = await guardWrite(request, reply, ctx);
    if (!idea) return reply;
    const { kpiId } = request.params as { kpiId: string };
    const kpi = await ctx.db.kpiDefinition.findFirst({
      where: { id: kpiId, ideaId: idea.id }, select: { id: true, name: true, unit: true, predictedValue: true },
    });
    if (!kpi) return sendError(reply, "NOT_FOUND", "No KPI with that id on this idea");
    await ctx.db.$transaction(async (tx) => {
      const m = await tx.kpiMeasurement.create({
        data: {
          definitionId: kpi.id, actualValue: parsed.data.actualValue, measuredAt: new Date(parsed.data.measuredAt),
          note: parsed.data.note || null, recordedById: requireActor(request).userId,
        },
      });
      await audit(tx, request, idea.id, "delivery.kpiMeasurement", {
        kpiId, measurementId: m.id, actualValue: parsed.data.actualValue, measuredAt: parsed.data.measuredAt,
      });
      await notifyResults(tx, request, idea.id, {
        kind: "MEASUREMENT", kpiName: kpi.name, unit: kpi.unit,
        actualValue: parsed.data.actualValue, predictedValue: num(kpi.predictedValue),
      });
    });
    return reply.status(201).send(await loadDelivery(ctx.db, request, idea.id));
  });

  handlers.set("updateIdeaFinancials", async (request, reply, ctx) => {
    const parsed = UpdateFinancialsRequest.safeParse(request.body);
    if (!parsed.success) return sendError(reply, "VALIDATION_FAILED", parsed.error.issues[0]?.message ?? "Invalid figures");
    const idea = await guardWrite(request, reply, ctx);
    if (!idea) return reply;
    const f = parsed.data;
    const data = {
      currency: f.currency,
      ...(f.investmentToDate !== undefined ? { investmentToDate: f.investmentToDate } : {}),
      ...(f.realizedBenefit !== undefined ? { realizedBenefit: f.realizedBenefit } : {}),
      ...(f.basisNote !== undefined ? { basisNote: f.basisNote || null } : {}),
      updatedById: requireActor(request).userId,
    };
    await ctx.db.$transaction(async (tx) => {
      const before = await tx.ideaFinancials.findUnique({ where: { ideaId: idea.id } });
      const saved = await tx.ideaFinancials.upsert({ where: { ideaId: idea.id }, create: { ideaId: idea.id, ...data }, update: data });
      await audit(
        tx, request, idea.id, "delivery.financials",
        { currency: saved.currency, investmentToDate: num(saved.investmentToDate), realizedBenefit: num(saved.realizedBenefit) },
        before
          ? { currency: before.currency, investmentToDate: num(before.investmentToDate), realizedBenefit: num(before.realizedBenefit) }
          : undefined,
      );
      await notifyResults(tx, request, idea.id, {
        kind: "FINANCIALS", kpiName: null, unit: null, actualValue: null, predictedValue: null,
      });
    });
    return loadDelivery(ctx.db, request, idea.id);
  });
}
