import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Resolve hook for running TypeScript sources offline under plain Node
 * (`node --experimental-strip-types`).
 *
 * Handles the two import shapes used across `src/`: the `@/` path alias and
 * extensionless relative imports. Everything else (zod, node builtins) falls
 * through to Node's default resolver.
 */

const SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "src",
);

const CANDIDATE_SUFFIXES = ["", ".ts", ".tsx", "/index.ts"];

export async function resolve(specifier, context, nextResolve) {
  let base = null;

  if (specifier.startsWith("@/")) {
    base = path.join(SRC, specifier.slice(2));
  } else if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    context.parentURL?.startsWith("file:")
  ) {
    const parentDir = path.dirname(fileURLToPath(context.parentURL));
    if (parentDir.startsWith(SRC)) {
      base = path.resolve(parentDir, specifier);
    }
  }

  if (base !== null) {
    for (const suffix of CANDIDATE_SUFFIXES) {
      const full = base + suffix;
      try {
        if (statSync(full).isFile()) {
          return { url: pathToFileURL(full).href, shortCircuit: true };
        }
      } catch {
        // Not a file (or missing) - keep trying the remaining suffixes.
      }
    }
  }

  return nextResolve(specifier, context);
}
