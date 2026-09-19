import type { Query } from "firebase-admin/firestore";
import { adminClinicCollection, adminClinicDoc, isGlobalCollection } from "@/lib/adminClinicDb";
import { adminDb } from "@/lib/firebaseAdmin";
import { COLLECTION_WRITE_PERMISSIONS, holdsPermission } from "@/lib/permissions";
import { resolveBriefingAccess } from "@/lib/automation/briefing/build";
import type { McpKeyScope } from "@/lib/mcp/keys";

/**
 * What an outside AI assistant can do inside one clinic.
 *
 * The protocol has no "here is the database" mode — a client can only call tools a server
 * declares — so full access is expressed as a small number of deliberately broad tools rather
 * than a long list of narrow ones. `query_collection` reads any collection the clinic owns with
 * whatever filter the assistant likes; `write_document` and `delete_document` exist for keys
 * minted with that scope. There is nothing an owner can see in the app that he cannot reach here.
 *
 * Three limits are structural rather than editorial, and none of them are about second-guessing
 * the clinic:
 *
 *   1. **One clinic.** Every path is built through `adminClinicCollection`, which prefixes
 *      `clinics/{clinicId}/`. A key cannot reach another practice's patients, because there is no
 *      argument that would take it there.
 *   2. **No root collections.** `adminClinicCollection` returns global collections *unprefixed* —
 *      that is correct for `users` and `clinics`, and catastrophic here, because it would turn a
 *      collection name into a platform-wide read. Rejected by name before any reference is built.
 *   3. **The staff member's own permissions.** The key acts as one person. If that person cannot
 *      open the finance screen in the app, the assistant does not get money answers either;
 *      otherwise connecting Claude would be a way around a permission checkbox.
 *
 * The fourth thing this file does is quieter but matters as much: tools return **facts, not
 * verdicts**. `attendance` comes back as punches and minutes, never as a ranking or a flag. The
 * assistant is free to form an opinion — that is what the clinic connected it for — but the
 * opinion is visibly the assistant's, not a judgment this system manufactured about an employee.
 */

export type McpToolContext = {
  clinicId: string;
  uid: string;
  role: string | null;
  permissions: string[];
  scope: McpKeyScope;
};

export type McpToolResult = { ok: true; data: unknown } | { ok: false; error: string };

/** Firestore's filter operators, as the assistant may name them. */
const OPERATORS = [
  "==",
  "!=",
  "<",
  "<=",
  ">",
  ">=",
  "array-contains",
  "array-contains-any",
  "in",
  "not-in",
] as const;
type Operator = (typeof OPERATORS)[number];

/**
 * The collections worth naming in a catalogue, with what each one holds.
 *
 * Not a permitted list — `query_collection` will read a collection that is missing from here, and
 * `list_collections` asks Firestore for the real set. It is documentation: an assistant that is
 * told `ledger` holds money movements asks a better first question than one that has to discover
 * the schema by trial.
 */
const COLLECTION_NOTES: Record<string, string> = {
  patients: "Patient records: name, phone, age, notes, balance.",
  appointments: "Bookings: patient, dentist, start/end, status, treatment.",
  ledger: "Every money movement — payments in, expenses out, discounts.",
  services: "The clinic's treatments and their prices.",
  clinical_notes: "Per-visit clinical records.",
  treatment_plans: "Proposed multi-visit plans and their acceptance state.",
  prescriptions: "Issued prescriptions.",
  lab_cases: "Work sent to the dental lab and its due dates.",
  lab_payments: "Money paid to labs.",
  inventory: "Stock items and quantities.",
  inventory_transactions: "Stock movements in and out.",
  staff: "Staff records held by the clinic.",
  attendance: "Clock-in and clock-out punches.",
  leads: "Enquiries that have not become patients yet.",
  marketing_campaigns: "Campaigns and their spend.",
  whatsapp_conversations: "WhatsApp threads with patients.",
  notifications: "Alerts raised inside the app.",
};

/**
 * Which permission a read needs, where the app asks for one.
 *
 * Mirrors `resolveBriefingAccess`, which is what the weekly brief and the payroll screen use, so
 * the three surfaces give one answer about who may see money and who may see staff records.
 * Anything absent is ordinary clinic working data, readable by any member — the same position
 * firestore.rules takes inside `clinics/{id}/`.
 */
const MONEY_COLLECTIONS = new Set(["ledger", "lab_payments"]);
const HR_COLLECTIONS = new Set(["attendance", "staff"]);

function readDenial(collection: string, ctx: McpToolContext): string | null {
  const access = resolveBriefingAccess(ctx.role, ctx.permissions);
  if (MONEY_COLLECTIONS.has(collection) && !access.money) {
    return `This connection acts as a staff member without finance access, so "${collection}" is not readable through it.`;
  }
  if (HR_COLLECTIONS.has(collection) && !access.hr) {
    return `This connection acts as a staff member without staff-records access, so "${collection}" is not readable through it.`;
  }
  return null;
}

/**
 * Rejects a collection name that would escape the clinic.
 *
 * A name with a slash in it is a path, and Firestore would happily interpret `../users` style
 * nesting as a subcollection walk. A global collection name is worse: it silently resolves to the
 * root, so `users` would return every account on the platform.
 */
function collectionDenial(raw: string): string | null {
  const name = (raw || "").trim();
  if (!name) return "A collection name is required.";
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    return `"${raw}" is not a collection name. Use a single name such as "patients".`;
  }
  if (isGlobalCollection(name)) {
    return `"${name}" is a platform-wide collection and is never reachable through a clinic connection.`;
  }
  return null;
}

/** Firestore values arrive as Timestamps and refs; JSON-RPC needs something a model can read. */
function serialize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (depth > 6) return "[nested]";
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof (obj as { toDate?: () => Date }).toDate === "function") {
      return (obj as { toDate: () => Date }).toDate().toISOString();
    }
    if (Array.isArray(value)) return value.map((v) => serialize(v, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = serialize(v, depth + 1);
    return out;
  }
  return value;
}

function applyFilters(base: Query, where: unknown): { query: Query } | { error: string } {
  let query = base;
  if (where === undefined || where === null) return { query };
  if (!Array.isArray(where)) return { error: "`where` must be a list of {field, op, value}." };

  for (const clause of where) {
    if (!clause || typeof clause !== "object") {
      return { error: "Each `where` entry must be an object {field, op, value}." };
    }
    const { field, op, value } = clause as Record<string, unknown>;
    if (typeof field !== "string" || !field.trim()) {
      return { error: "Each `where` entry needs a `field`." };
    }
    const operator = (typeof op === "string" ? op : "==") as Operator;
    if (!OPERATORS.includes(operator)) {
      return { error: `"${String(op)}" is not a filter operator. Use one of: ${OPERATORS.join(", ")}.` };
    }
    query = query.where(field, operator, value ?? null);
  }
  return { query };
}

/**
 * The catalogue the assistant is shown.
 *
 * Descriptions are written for a model that has never seen this system: they say what the data
 * means and, where it matters, what it does not mean. Write tools are only listed for a key that
 * holds the scope, because a tool a client can see is a tool it will eventually try.
 */
export function mcpToolCatalogue(scope: McpKeyScope) {
  const read = [
    {
      name: "list_collections",
      description:
        "List every kind of record this clinic holds, with a note on what each contains. Call this first when you do not know where something lives.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "describe_collection",
      description:
        "Show the field names actually present on recent records in a collection, so you can filter on real fields rather than guessing.",
      inputSchema: {
        type: "object",
        properties: { collection: { type: "string" } },
        required: ["collection"],
        additionalProperties: false,
      },
    },
    {
      name: "query_collection",
      description:
        "Read records from any collection in this clinic, with optional filters, ordering and a limit. This is the general-purpose read: most questions are answered with it.",
      inputSchema: {
        type: "object",
        properties: {
          collection: { type: "string" },
          where: {
            type: "array",
            description: 'Filters, e.g. [{"field":"status","op":"==","value":"Confirmed"}].',
            items: {
              type: "object",
              properties: {
                field: { type: "string" },
                op: { type: "string", enum: [...OPERATORS] },
                value: {},
              },
              required: ["field"],
            },
          },
          orderBy: { type: "string" },
          direction: { type: "string", enum: ["asc", "desc"] },
          limit: { type: "number", description: "Default 50, maximum 500." },
        },
        required: ["collection"],
        additionalProperties: false,
      },
    },
    {
      name: "get_document",
      description: "Fetch one record by its id.",
      inputSchema: {
        type: "object",
        properties: { collection: { type: "string" }, id: { type: "string" } },
        required: ["collection", "id"],
        additionalProperties: false,
      },
    },
    {
      name: "count_collection",
      description:
        "Count matching records without reading them. Use this for 'how many' questions — it is far cheaper than fetching and counting.",
      inputSchema: {
        type: "object",
        properties: {
          collection: { type: "string" },
          where: { type: "array", items: { type: "object" } },
        },
        required: ["collection"],
        additionalProperties: false,
      },
    },
  ];

  if (scope !== "full") return read;

  return [
    ...read,
    {
      name: "write_document",
      description:
        "Create or update one record. Confirm the exact change with the person before calling this — it takes effect immediately in the live clinic system.",
      inputSchema: {
        type: "object",
        properties: {
          collection: { type: "string" },
          id: { type: "string", description: "Omit to create a new record." },
          data: { type: "object" },
          merge: { type: "boolean", description: "Default true: leave untouched fields alone." },
        },
        required: ["collection", "data"],
        additionalProperties: false,
      },
    },
    {
      name: "delete_document",
      description:
        "Permanently delete one record. There is no undo. Confirm with the person first, every time.",
      inputSchema: {
        type: "object",
        properties: { collection: { type: "string" }, id: { type: "string" } },
        required: ["collection", "id"],
        additionalProperties: false,
      },
    },
  ];
}

export async function runMcpTool(
  name: string,
  rawArgs: Record<string, unknown>,
  ctx: McpToolContext
): Promise<McpToolResult> {
  const args = rawArgs || {};

  if (name === "list_collections") {
    // The live set, not a hardcoded list — a clinic that has started using a feature we shipped
    // last week should see it here without this file being edited.
    const subs = await adminDb().collection("clinics").doc(ctx.clinicId).listCollections();
    const names = subs.map((c) => c.id).sort();
    return {
      ok: true,
      data: {
        collections: names.map((id) => ({
          name: id,
          describes: COLLECTION_NOTES[id] ?? null,
          readable: readDenial(id, ctx) === null,
        })),
      },
    };
  }

  const collection = String(args.collection ?? "").trim();

  if (name === "describe_collection" || name === "query_collection" || name === "count_collection" || name === "get_document" || name === "write_document" || name === "delete_document") {
    const denial = collectionDenial(collection);
    if (denial) return { ok: false, error: denial };
  }

  switch (name) {
    case "describe_collection": {
      const denial = readDenial(collection, ctx);
      if (denial) return { ok: false, error: denial };
      const snap = await adminClinicCollection(ctx.clinicId, collection).limit(25).get();
      const fields = new Set<string>();
      for (const doc of snap.docs) for (const key of Object.keys(doc.data())) fields.add(key);
      return {
        ok: true,
        data: {
          collection,
          describes: COLLECTION_NOTES[collection] ?? null,
          sampledRecords: snap.size,
          fields: [...fields].sort(),
        },
      };
    }

    case "query_collection": {
      const denial = readDenial(collection, ctx);
      if (denial) return { ok: false, error: denial };

      const filtered = applyFilters(adminClinicCollection(ctx.clinicId, collection), args.where);
      if ("error" in filtered) return { ok: false, error: filtered.error };
      let query = filtered.query;

      const orderBy = typeof args.orderBy === "string" ? args.orderBy.trim() : "";
      if (orderBy) {
        query = query.orderBy(orderBy, args.direction === "asc" ? "asc" : "desc");
      }

      // Capped because the caller is a language model paying by the token: an unbounded read of
      // a busy clinic's ledger is slow here and expensive there, and nobody asked for 40,000 rows.
      const requested = Number(args.limit);
      const limit = Number.isFinite(requested) ? Math.min(Math.max(1, Math.floor(requested)), 500) : 50;

      try {
        const snap = await query.limit(limit).get();
        return {
          ok: true,
          data: {
            collection,
            returned: snap.size,
            truncated: snap.size === limit,
            records: snap.docs.map((d) => ({ id: d.id, ...(serialize(d.data()) as object) })),
          },
        };
      } catch (error) {
        // Almost always a missing composite index. Saying so turns a dead end into a next step.
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          error: message.includes("index")
            ? `Firestore needs an index for that combination of filter and ordering. Try fewer filters, or order by the field you are filtering on. (${message})`
            : message,
        };
      }
    }

    case "count_collection": {
      const denial = readDenial(collection, ctx);
      if (denial) return { ok: false, error: denial };
      const filtered = applyFilters(adminClinicCollection(ctx.clinicId, collection), args.where);
      if ("error" in filtered) return { ok: false, error: filtered.error };
      const snap = await filtered.query.count().get();
      return { ok: true, data: { collection, count: snap.data().count } };
    }

    case "get_document": {
      const denial = readDenial(collection, ctx);
      if (denial) return { ok: false, error: denial };
      const id = String(args.id ?? "").trim();
      if (!id) return { ok: false, error: "An `id` is required." };
      const snap = await adminClinicDoc(ctx.clinicId, collection, id).get();
      if (!snap.exists) return { ok: false, error: `No record "${id}" in "${collection}".` };
      return { ok: true, data: { id: snap.id, ...(serialize(snap.data()) as object) } };
    }

    case "write_document":
    case "delete_document": {
      if (ctx.scope !== "full") {
        return {
          ok: false,
          error: "This connection is read-only. A key with write access is minted separately in Settings.",
        };
      }

      const verb = name === "delete_document" ? "delete" : args.id ? "update" : "create";
      const needed = COLLECTION_WRITE_PERMISSIONS[verb as "create" | "update" | "delete"]?.[collection] ?? null;
      if (!holdsPermission(ctx.role, ctx.permissions, needed)) {
        return {
          ok: false,
          error: `This connection acts as a staff member who cannot ${verb} records in "${collection}".`,
        };
      }

      if (name === "delete_document") {
        const id = String(args.id ?? "").trim();
        if (!id) return { ok: false, error: "An `id` is required." };
        await adminClinicDoc(ctx.clinicId, collection, id).delete();
        return { ok: true, data: { deleted: true, collection, id } };
      }

      const data = args.data;
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        return { ok: false, error: "`data` must be an object of fields." };
      }

      // Firestore rejects the whole write when any field is `undefined`, and a model composing
      // JSON produces them constantly. Dropping them is what the caller meant by leaving a field
      // out, and it turns a silent failure into the obvious behaviour.
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
        if (v !== undefined) clean[k] = v;
      }
      // Stamped so a record that turns up in the app has a traceable origin. Somebody will ask
      // "who changed this?" and "an AI assistant, through key X" is a better answer than silence.
      clean.updatedAt = new Date();
      clean.updatedVia = "mcp";
      clean.updatedByUid = ctx.uid;

      const id = String(args.id ?? "").trim();
      const ref = id
        ? adminClinicDoc(ctx.clinicId, collection, id)
        : adminClinicCollection(ctx.clinicId, collection).doc();
      await ref.set(clean, { merge: args.merge !== false });
      return { ok: true, data: { written: true, collection, id: ref.id, mode: id ? "update" : "create" } };
    }

    default:
      return { ok: false, error: `No such tool: "${name}".` };
  }
}
