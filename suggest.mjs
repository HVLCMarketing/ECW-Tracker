// Suggestion form for staff who don't use the tracker.
//   POST /api/suggest/file   raw file bytes; headers x-filename, content-type, and x-code (form) or x-edit-key (tracker) -> { id, name, size, type }
//   POST /api/suggest        JSON { name, dept, title, details, kind, priority, files:[ids], code, website }
//                            -> adds a "New" input under Inputs by department
//   GET  /api/file?id=...    serves an uploaded file
//
// Optional: set SUGGEST_CODE in Netlify environment variables and share the form as /suggest.html?code=...
import { getStore } from "@netlify/blobs";

const PLAN_KEY = "plan";
const MAX_FILE = 4 * 1024 * 1024; // keeps each upload under Netlify's 6 MB request limit
const MAX_FILES = 5;
const LOG_MAX = 500;
const INLINE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"]);
const ALLOWED = new Set([
  ...INLINE, "image/heic", "image/heif",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain", "text/csv",
]);
const EXT = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", heic: "image/heic", heif: "image/heif",
  pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", txt: "text/plain", csv: "text/csv" };

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const env = (k) => (globalThis.Netlify && Netlify.env && Netlify.env.get(k)) || process.env[k] || "";
const codeOk = (c) => !env("SUGGEST_CODE") || String(c || "") === env("SUGGEST_CODE");
// Tracker users (who have the edit passcode) can also upload, e.g. images attached to subtasks.
const keyOk = (k) => !!env("EDIT_KEY") && String(k || "") === env("EDIT_KEY");
const clean = (v, n) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, n);
const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

export default async (req) => {
  const url = new URL(req.url);
  const files = getStore({ name: "ecw-files", consistency: "strong" });

  // ---- serve a file ----
  if (url.pathname === "/api/file" && req.method === "GET") {
    const id = url.searchParams.get("id") || "";
    if (!/^[a-f0-9]{32}$/.test(id)) return json(404, { error: "Not found" });
    const f = await files.getWithMetadata(id, { type: "arrayBuffer" });
    if (!f) return json(404, { error: "Not found" });
    const m = f.metadata || {};
    const type = ALLOWED.has(m.type) ? m.type : "application/octet-stream";
    const name = String(m.name || "file").replace(/[^\w.\- ()]+/g, "_");
    return new Response(f.data, { headers: {
      "content-type": type,
      "content-disposition": `${INLINE.has(type) ? "inline" : "attachment"}; filename="${name}"`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "cache-control": "private, max-age=3600",
    } });
  }

  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  // ---- upload one file ----
  if (url.pathname === "/api/suggest/file") {
    if (!codeOk(req.headers.get("x-code")) && !keyOk(req.headers.get("x-edit-key"))) return json(401, { error: "Upload refused: the passcode or form link isn’t valid." });
    const name = clean(decodeURIComponent(req.headers.get("x-filename") || "file"), 150) || "file";
    let type = (req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!ALLOWED.has(type)) type = EXT[(name.split(".").pop() || "").toLowerCase()] || "";
    if (!ALLOWED.has(type)) return json(415, { error: `${name}: only pictures, PDFs, Word, Excel, PowerPoint, text and CSV files can be attached.` });
    const buf = await req.arrayBuffer();
    if (!buf.byteLength) return json(400, { error: `${name} is empty.` });
    if (buf.byteLength > MAX_FILE) return json(413, { error: `${name} is larger than 4 MB.` });
    const id = rid();
    await files.set(id, buf, { metadata: { name, type, size: buf.byteLength, at: new Date().toISOString() } });
    return json(200, { id, name, size: buf.byteLength, type });
  }

  // ---- submit the suggestion ----
  if (url.pathname === "/api/suggest") {
    let b;
    try { b = await req.json(); } catch { return json(400, { error: "Could not read the form." }); }
    if (!codeOk(b.code)) return json(401, { error: "This form link isn’t valid. Ask for the current link." });
    if (b.website) return json(200, { ok: true }); // honeypot: bots fill hidden fields
    const name = clean(b.name, 80), title = clean(b.title, 200), dept = clean(b.dept, 80);
    if (!name || !title || !dept) return json(400, { error: "Please fill in your name, department and suggestion." });
    if (!b.noPhi) return json(400, { error: "Please confirm there’s no patient information." });

    const ids = (Array.isArray(b.files) ? b.files : []).filter((x) => /^[a-f0-9]{32}$/.test(x)).slice(0, MAX_FILES);
    const fileRows = [];
    for (const id of ids) {
      const meta = await files.getMetadata(id);
      if (meta) fileRows.push({ id, name: meta.metadata?.name || "file", size: meta.metadata?.size || 0, type: meta.metadata?.type || "" });
    }
    const at = new Date().toISOString();
    const row = {
      id: "f" + rid().slice(0, 10),
      dept, wish: title,
      problem: clean(b.details, 5000),
      category: clean(b.kind, 60),
      priority: ["Must-have for go-live", "Soon after go-live", "Later"].includes(b.priority) ? b.priority : "",
      status: "New", owner: "", target: "", site: clean(b.site, 80), notes: "",
      by: name, at, source: "Form", files: fileRows,
    };

    const store = getStore({ name: "ecw-tracker", consistency: "strong" });
    for (let i = 0; i < 4; i++) {
      const cur = await store.getWithMetadata(PLAN_KEY, { type: "json" });
      const doc = (cur && cur.data) || {};
      if (!doc.data) return json(503, { error: "The tracker isn’t set up yet. Please try again later." });
      const data = doc.data;
      data.wishes = data.wishes || [];
      data.wishes.push(row);
      const next = {
        data,
        version: (doc.version || 0) + 1,
        log: [{ at, by: `${name} (suggestion form)`, what: `New input from the suggestion form for ${dept}: “${title}”${fileRows.length ? ` (${fileRows.length} file${fileRows.length === 1 ? "" : "s"})` : ""}` }].concat(doc.log || []).slice(0, LOG_MAX),
        updatedAt: at,
      };
      const res = await store.setJSON(PLAN_KEY, next, { onlyIfMatch: cur.etag });
      if (res.modified) return json(200, { ok: true });
    }
    return json(503, { error: "The tracker was busy. Please press Send again." });
  }

  return json(404, { error: "Not found" });
};

export const config = { path: ["/api/suggest", "/api/suggest/file", "/api/file"] };
