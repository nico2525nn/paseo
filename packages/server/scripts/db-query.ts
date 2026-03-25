#!/usr/bin/env npx tsx
/**
 * Run arbitrary SQL against the running Paseo daemon's PGlite database.
 *
 * Connects to the daemon's dev query endpoint (available in dev mode only).
 *
 * Usage:
 *   npx tsx packages/server/scripts/db-query.ts "SELECT * FROM agent_snapshots"
 *   npx tsx packages/server/scripts/db-query.ts --port 6767 "SELECT count(*) FROM agent_timeline_rows"
 *
 * Without args, shows table row counts.
 */

import path from "node:path";
import os from "node:os";
import fs from "node:fs";

function findDaemonPort(explicit?: string): number {
  if (explicit) return parseInt(explicit, 10);

  // Check for running dev daemon config
  const tmpDir = os.tmpdir();
  for (const entry of fs.readdirSync(tmpDir)) {
    if (entry.startsWith("paseo-dev.")) {
      const configPath = path.join(tmpDir, entry, "config.json");
      if (fs.existsSync(configPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
          const listen = config.daemon?.listen;
          if (typeof listen === "string") {
            const portMatch = listen.match(/:(\d+)$/);
            if (portMatch) return parseInt(portMatch[1]!, 10);
          }
        } catch {}
      }
    }
  }

  return 6767;
}

async function main() {
  const args = process.argv.slice(2);
  let port: string | undefined;
  const queries: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) {
      port = args[++i];
    } else {
      queries.push(args[i]!);
    }
  }

  if (queries.length === 0) {
    queries.push(
      "SELECT 'agent_snapshots' AS table_name, count(*)::int AS rows FROM agent_snapshots UNION ALL " +
        "SELECT 'agent_timeline_rows', count(*)::int FROM agent_timeline_rows UNION ALL " +
        "SELECT 'projects', count(*)::int FROM projects UNION ALL " +
        "SELECT 'workspaces', count(*)::int FROM workspaces " +
        "ORDER BY table_name",
    );
  }

  const daemonPort = findDaemonPort(port);
  const url = `http://localhost:${daemonPort}/dev/db-query`;

  for (const sql of queries) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql }),
      });

      if (!res.ok) {
        const text = await res.text();
        console.error(`HTTP ${res.status}: ${text}`);
        continue;
      }

      const { rows } = await res.json();
      if (rows.length === 0) {
        console.log("(0 rows)\n");
      } else {
        console.table(rows);
      }
    } catch (err: any) {
      if (err.cause?.code === "ECONNREFUSED") {
        console.error(`Cannot connect to daemon at port ${daemonPort}. Is it running?`);
        process.exit(1);
      }
      console.error(`Error: ${err.message}\n`);
    }
  }
}

main();
