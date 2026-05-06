/**
 * Vercel serverless proxy → Anthropic Messages API.
 * Key: ANTHROPIC_API_KEY (Vercel dashboard / env).
 *
 * Note: `vercel dev` often does NOT inject root `.env` into this function's
 * process.env. We read `.env.local` then `.env` from cwd once as a fallback.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let triedLocalEnvFiles = false;

function loadLocalEnvOnce() {
  if (triedLocalEnvFiles) return;
  triedLocalEnvFiles = true;
  if (process.env.ANTHROPIC_API_KEY) return;

  const roots = [
    process.cwd(),
    path.join(__dirname, ".."),
    path.join(__dirname, "..", ".."),
  ];
  const seen = new Set();
  const rootsUnique = roots.filter((r) => {
    const n = path.normalize(r);
    if (seen.has(n)) return false;
    seen.add(n);
    return true;
  });

  for (const root of rootsUnique) {
  for (const name of [".env.local", ".env"]) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      if (key !== "ANTHROPIC_API_KEY") continue;
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (val) {
        process.env.ANTHROPIC_API_KEY = val;
        return;
      }
    }
  }
  }
}

export default async function handler(req, res) {
  loadLocalEnvOnce();

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: "Server misconfiguration",
      detail:
        "ANTHROPIC_API_KEY is missing. Add it to `.env` or `.env.local` in the project root (same folder as vercel.json), restart `vercel dev`, or set it in Vercel → Project → Settings → Environment Variables for production.",
    });
  }

  const payload = typeof req.body === "string" ? safeJson(req.body) : req.body;
  if (payload == null) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(502).json({
        error: "Anthropic returned non-JSON",
        status: response.status,
        snippet: text.slice(0, 500),
      });
    }

    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Proxy request failed",
    });
  }
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
