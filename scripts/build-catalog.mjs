// SPDX-License-Identifier: AGPL-3.0-only
// Writes catalog.json: the list that zerodot reads to show packages one can install.
// Build the packages first (`pnpm run build`). Run: `pnpm run catalog`.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const packages = [];

// The catalog that is on disk now. A package keeps its entry from here while npm
// does not show its new version yet.
const catalogPath = join(root, "catalog.json");
const oldEntries = new Map();
try {
  for (const entry of JSON.parse(readFileSync(catalogPath, "utf8")).packages ?? [])
    oldEntries.set(entry.name, entry);
} catch {
  // No catalog yet, or a bad file: start from an empty list.
}

// A package that is not on npm yet cannot be installed, so it stays out of the catalog.
async function isPublished(name, version) {
  const response = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2f")}/${version}`);
  if (response.status === 404) return false;
  if (!response.ok)
    throw new Error(`npm registry answered ${response.status} for ${name}@${version}`);
  return true;
}

for (const folder of readdirSync(join(root, "packages")).sort()) {
  const dir = join(root, "packages", folder);
  const json = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  if (json.private || !json.zerodot?.sdk) continue;
  if (!(await isPublished(json.name, json.version))) {
    const old = oldEntries.get(json.name);
    if (old) {
      console.log(`keep ${json.name}@${old.version}: ${json.version} is not on npm`);
      packages.push(old);
    } else {
      console.log(`skip ${json.name}@${json.version}: not on npm`);
    }
    continue;
  }
  const entry = typeof json.exports === "string" ? json.exports : json.exports?.["."];
  const loaded = await import(pathToFileURL(join(dir, entry)).href);
  // The icon of the package is the icon of its first node that has one.
  const icon = loaded.nodes.find((node) => node.iconUrl || node.icon);
  packages.push({
    name: json.name,
    label: json.zerodot.label ?? json.name,
    summary: json.zerodot.summary ?? "",
    description: json.description ?? "",
    version: json.version,
    sdk: json.zerodot.sdk,
    ...(icon?.icon ? { icon: icon.icon } : {}),
    ...(icon?.iconUrl ? { iconUrl: icon.iconUrl } : {}),
    nodes: loaded.nodes.map((node) => ({
      type: node.type,
      label: node.label,
      ...(node.description ? { description: node.description } : {}),
    })),
    credentialTypes: (loaded.credentialTypes ?? []).map((credential) => credential.type),
  });
}

writeFileSync(catalogPath, `${JSON.stringify({ version: 1, packages }, null, 2)}\n`);
console.log(`catalog.json: ${packages.length} package(s)`);
