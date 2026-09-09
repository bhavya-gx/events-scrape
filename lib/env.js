// Minimal .env loader (no dependency). Vercel injects env vars itself, so
// there this is a no-op; locally it reads ./.env next to server.js.
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", ".env");
if (fs.existsSync(file)) {
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
}
