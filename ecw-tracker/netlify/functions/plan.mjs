// Shared storage for the tracker, using Netlify Blobs (no outside database needed).
import { getStore } from "@netlify/blobs";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export default async (req) => {
  const store = getStore({ name: "ecw-tracker", consistency: "strong" });
  const editKey = process.env.EDIT_KEY || "";

  if (req.method === "GET") {
    const doc = (await store.get("plan", { type: "json" })) || { data: null, version: 0, log: [] };
    return json({ ...doc, editKeyRequired: !!editKey });
  }

  if (req.method === "PUT") {
    if (editKey && req.headers.get("x-edit-key") !== editKey) {
      return json({ error: "The edit passcode is missing or incorrect." }, 401);
    }
    let body;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON." }, 400); }
    if (!body || typeof body.data !== "object" || !Array.isArray(body.data?.tasks)) {
      return json({ error: "Missing plan data." }, 400);
    }
    if (JSON.stringify(body.data).length > 2_000_000) return json({ error: "Plan is too large." }, 413);

    const cur = (await store.get("plan", { type: "json" })) || { data: null, version: 0, log: [] };
    // Optimistic concurrency: reject a save based on an older version so nobody overwrites someone else.
    if (body.baseVersion !== cur.version) return json({ conflict: true, ...cur, editKeyRequired: !!editKey }, 409);

    const entries = (Array.isArray(body.changes) ? body.changes : []).slice(0, 50).map((c) => ({
      at: new Date().toISOString(),
      by: String(body.editor || "Unknown").slice(0, 80),
      what: String(c).slice(0, 300),
    }));
    const next = { data: body.data, version: cur.version + 1, log: [...entries.reverse(), ...(cur.log || [])].slice(0, 500) };
    await store.setJSON("plan", next);
    return json({ ...next, editKeyRequired: !!editKey });
  }

  return json({ error: "Method not allowed." }, 405);
};

export const config = { path: "/api/plan" };
