import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const wrangler = path.join(root, "node_modules", "wrangler", "wrangler-dist", "cli.js");
const localConfigDirectory = path.join(root, ".cloudflare");
const localConfigPath = path.join(localConfigDirectory, "deploy.json");
const databaseName = "parry-grove-production";
const workerName = "parry-grove";

function run(args, { capture = false, env = process.env } = {}) {
  const result = spawnSync(process.execPath, [wrangler, ...args], {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (capture && result.stdout) process.stdout.write(result.stdout);
    if (capture && result.stderr) process.stderr.write(result.stderr);
    throw new Error(`wrangler ${args[0]} failed with exit code ${result.status ?? "unknown"}`);
  }
  return result.stdout ?? "";
}

function resolveDatabaseId() {
  if (process.env.CLOUDFLARE_D1_DATABASE_ID) return process.env.CLOUDFLARE_D1_DATABASE_ID;
  try {
    const config = JSON.parse(readFileSync(localConfigPath, "utf8"));
    if (typeof config.database_id === "string" && config.database_id) return config.database_id;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const listed = run(["d1", "list"], { capture: true });
  const listedRow = listed.split(/\r?\n/).find((line) => line.includes(databaseName));
  let databaseId = listedRow?.split("│").map((field) => field.trim())[1];
  if (!databaseId || !/^[a-f0-9-]{36}$/i.test(databaseId)) {
    const created = run(["d1", "create", databaseName], { capture: true });
    process.stdout.write(created);
    databaseId = created.match(/"database_id"\s*:\s*"([a-f0-9-]{36})"/i)?.[1]
      ?? created.match(/database_id\s*=\s*["']?([a-f0-9-]{36})/i)?.[1];
  }
  if (typeof databaseId !== "string" || !databaseId) {
    throw new Error("Could not find database_id in Wrangler's D1 create response.");
  }

  mkdirSync(localConfigDirectory, { recursive: true });
  writeFileSync(localConfigPath, `${JSON.stringify({ database_id: databaseId }, null, 2)}\n`, "utf8");
  return databaseId;
}

function getWranglerOAuthToken() {
  const configRoot = process.env.APPDATA
    ? path.join(process.env.APPDATA, "xdg.config", ".wrangler")
    : path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), ".wrangler");
  const authPath = path.join(configRoot, "config", "default.toml");
  const authFile = readFileSync(authPath, "utf8");
  return authFile.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
}

async function ensureWorkersSubdomain(accountId) {
  let localConfig = {};
  try {
    localConfig = JSON.parse(readFileSync(localConfigPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (localConfig.workers_subdomain) return localConfig.workers_subdomain;

  const token = getWranglerOAuthToken();
  if (!token) throw new Error("Could not read Wrangler OAuth credentials to set up workers.dev. Open Workers & Pages in the Cloudflare dashboard once, then retry.");
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const current = await fetch(endpoint, { headers });
  if (current.ok) {
    const body = await current.json();
    const subdomain = body.result?.subdomain;
    if (subdomain) {
      writeFileSync(localConfigPath, `${JSON.stringify({ ...localConfig, workers_subdomain: subdomain, account_id: accountId }, null, 2)}\n`, "utf8");
      return subdomain;
    }
  }

  const proposed = "parry-grove-game";
  const created = await fetch(endpoint, {
    method: "PUT",
    headers,
    body: JSON.stringify({ subdomain: proposed }),
  });
  const body = await created.json();
  if (!created.ok || !body.success) {
    const detail = body.errors?.map((entry) => entry.message).filter(Boolean).join("; ");
    throw new Error(`Could not create the workers.dev subdomain '${proposed}'. ${detail || "Open Workers & Pages in the Cloudflare dashboard to choose an available subdomain, then retry."}`);
  }
  const subdomain = body.result?.subdomain ?? proposed;
  writeFileSync(localConfigPath, `${JSON.stringify({ ...localConfig, workers_subdomain: subdomain, account_id: accountId }, null, 2)}\n`, "utf8");
  return subdomain;
}

async function main() {
  let whoami;
  try {
    whoami = run(["whoami"], { capture: true });
    process.stdout.write(whoami);
  } catch {
    throw new Error("Cloudflare authentication is unavailable. Run `npx wrangler login` and finish browser authorization, then retry `npm run deploy:cloudflare`.");
  }
  const accountId = whoami.match(/│\s*[^│]+\s*│\s*([a-f0-9]{32})\s*│/i)?.[1];
  if (!accountId) throw new Error("Could not identify the Cloudflare account ID from Wrangler.");

  const databaseId = resolveDatabaseId();
  const workersSubdomain = await ensureWorkersSubdomain(accountId);
  run([
    "d1", "execute", databaseName, "--remote", "--file",
    path.join(root, "drizzle", "0000_happy_kang.sql"),
  ]);

  const env = {
    ...process.env,
    CLOUDFLARE_D1_DATABASE_ID: databaseId,
    CLOUDFLARE_D1_DATABASE_NAME: databaseName,
    CLOUDFLARE_WORKER_NAME: workerName,
  };
  const build = spawnSync(process.execPath, [path.join(root, "scripts", "run-framework.mjs"), "build"], {
    cwd: root,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (build.error) throw build.error;
  if (build.status !== 0) throw new Error(`Production build failed with exit code ${build.status ?? "unknown"}.`);

  const deployOutput = run(["deploy", "--config", path.join(root, "dist", "server", "wrangler.json")], { capture: true, env });
  process.stdout.write(deployOutput);
  const deployedUrl = deployOutput.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0];
  if (deployedUrl) process.stdout.write(`\nGame URL: ${deployedUrl}\n`);
  else process.stdout.write(`\nGame URL: https://${workerName}.${workersSubdomain}.workers.dev\n`);
  process.stdout.write(`Remote D1 database: ${databaseName}\n`);
  process.stdout.write("Local database ID saved in .cloudflare/deploy.json (ignored by Git).\n");
}

main().catch((error) => {
  process.stderr.write(`\nCloudflare deployment stopped: ${error.message}\n`);
  process.exitCode = 1;
});
