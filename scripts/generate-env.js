/**
 * Lee .env y genera js/env.config.js con window.process.env
 * Uso: node scripts/generate-env.js
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const envPath = path.join(root, ".env");
const outPath = path.join(root, "js", "env.config.js");

function parseEnvFile(content) {
  const vars = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

if (!fs.existsSync(envPath)) {
  console.error("No se encontró .env en la raíz del proyecto.");
  process.exit(1);
}

const vars = parseEnvFile(fs.readFileSync(envPath, "utf8"));
const url = vars.SUPABASE_URL || "";
const key = vars.SUPABASE_ANON_KEY || "";

const output = `/**
 * Generado automáticamente desde .env — no editar a mano.
 * Regenerar: node scripts/generate-env.js
 */
window.process = {
  env: {
    SUPABASE_URL: ${JSON.stringify(url)},
    SUPABASE_ANON_KEY: ${JSON.stringify(key)},
  },
};

if (typeof process === "undefined") {
  var process = window.process;
}
`;

fs.writeFileSync(outPath, output, "utf8");
console.log("✓ Generado:", outPath);
