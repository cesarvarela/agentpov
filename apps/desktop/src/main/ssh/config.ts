import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

/**
 * Concrete host aliases from ~/.ssh/config, following `Include` lines that
 * name plain files. Wildcard and negated patterns are skipped: they are rules,
 * not hosts you can connect to.
 */
export async function listSshHosts(): Promise<string[]> {
  const sshDir = join(homedir(), ".ssh");
  const hosts = new Set<string>();
  const seen = new Set<string>();

  async function visit(path: string): Promise<void> {
    if (seen.has(path)) return;
    seen.add(path);
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch {
      return;
    }
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      // "Keyword value", "Keyword=value" and "Keyword = value" are all valid.
      const match = /^([^\s=]+)[\s=]+(.*)$/.exec(line);
      if (!match) continue;
      const keyword = match[1]!.toLowerCase();
      const args = match[2]!.split(/\s+/).filter(Boolean);
      if (keyword === "host") {
        for (const name of args) {
          if (!/[*?!]/.test(name)) hosts.add(name);
        }
      } else if (keyword === "include") {
        for (const arg of args) {
          if (/[*?]/.test(arg)) continue;
          const expanded = arg.startsWith("~/") ? join(homedir(), arg.slice(2)) : arg;
          await visit(isAbsolute(expanded) ? expanded : join(sshDir, expanded));
        }
      }
    }
  }

  await visit(join(sshDir, "config"));
  return [...hosts];
}
