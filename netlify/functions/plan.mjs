// Shared plan for the eCW Implementation Tracker, stored in Netlify Blobs.
// The page calls GET /api/plan to load and PUT /api/plan to save.
//
// GET  -> { data, version, log, editKeyRequired, updatedAt }
// PUT  body { data, baseVersion, editor, changes[] }, header x-edit-key
//      200 { version, log }           saved
//      409 { data, version, log }     someone saved first; the page replays its edits and retries
//      401 { error }                  wrong or missing passcode (only when EDIT_KEY is set)
//
// Optional: set EDIT_KEY in Netlify > Site configuration > Environment variables.
import { getStore } from "@netlify/blobs";

const KEY = "plan";
const LOG_MAX = 500;

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const editKey = () =>
  (globalThis.Netlify && Netlify.env && Netlify.env.get("EDIT_KEY")) || process.env.EDIT_KEY || "";

export default async (req) => {
  const store = getStore({ name: "ecw-tracker", consistency: "strong" });

  if (req.method === "GET") {
    const cur = await store.getWithMetadata(KEY, { type: "json" });
    const doc = (cur && cur.data) || {};
    return json(200, {
      data: doc.data || null,
      version: doc.version || 0,
      log: doc.log || [],
      updatedAt: doc.updatedAt || "",
      editKeyRequired: !!editKey(),
    });
  }

  if (req.method === "PUT" || req.method === "POST") {
    const want = editKey();
    if (want && req.headers.get("x-edit-key") !== want) {
      return json(401, { error: "That passcode is not right. Ask the COO for the current edit passcode." });
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return json(400, { error: "Could not read the change." });
    }
    if (!body || typeof body.data !== "object" || body.data === null) {
      return json(400, { error: "Nothing to save." });
    }

    const cur = await store.getWithMetadata(KEY, { type: "json" });
    const doc = (cur && cur.data) || {};
    const version = doc.version || 0;
    if (Number(body.baseVersion) !== version) {
      return json(409, { data: doc.data || null, version, log: doc.log || [] });
    }

    const at = new Date().toISOString();
    const by = String(body.editor || "Unknown").slice(0, 80);
    const entries = (Array.isArray(body.changes) ? body.changes : [])
      .slice(0, 200)
      .map((what) => ({ at, by, what: String(what).slice(0, 500) }))
      .reverse();
    const next = {
      data: body.data,
      version: version + 1,
      log: entries.concat(doc.log || []).slice(0, LOG_MAX),
      updatedAt: at,
    };

    // Conditional write: if someone else saved between our read and this write, nothing is overwritten.
    const res = cur && cur.etag
      ? await store.setJSON(KEY, next, { onlyIfMatch: cur.etag })
      : await store.setJSON(KEY, next, { onlyIfNew: true });
    if (!res.modified) {
      const latest = await store.get(KEY, { type: "json" });
      return json(409, { data: (latest && latest.data) || null, version: (latest && latest.version) || 0, log: (latest && latest.log) || [] });
    }
    return json(200, { version: next.version, log: next.log });
  }

  return json(405, { error: "Method not allowed" });
};

export const config = { path: "/api/plan" };
