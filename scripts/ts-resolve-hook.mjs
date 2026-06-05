// PHA-925 — Node ESM resolver hook for the offline verify-*.ts harness.
//
// The app uses `moduleResolution: "bundler"`, so source files import sibling
// modules WITHOUT a file extension (e.g. `import { x } from "./swiss-bucket-core"`).
// Node's stock ESM resolver does NOT auto-append `.ts`/`.js`/`/index.ts`, so any
// verify script whose import chain reaches such a *value* import dies with
// ERR_MODULE_NOT_FOUND under `node --experimental-strip-types`.
//
// This hook bridges the gap WITHOUT mutating the source imports (which would
// break `tsc`'s bundler resolution unless allowImportingTsExtensions were set).
// It only touches relative specifiers that fail to resolve as-is, trying the
// extensions and index forms that the bundler resolver would have found.
//
// Zero runtime dependencies on purpose: the harness must stay offline and
// install-free. Registered via scripts/register-ts-resolve.mjs (--import).
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const CANDIDATE_SUFFIXES = [
  ".ts",
  ".tsx",
  ".mts",
  ".js",
  ".mjs",
  "/index.ts",
  "/index.tsx",
  "/index.js",
];

export async function resolve(specifier, context, nextResolve) {
  // Only intervene for relative specifiers that have no usable extension.
  const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
  if (isRelative) {
    try {
      // If Node can already resolve it (e.g. an explicit extension), defer.
      return await nextResolve(specifier, context);
    } catch (err) {
      if (err?.code !== "ERR_MODULE_NOT_FOUND") throw err;
      const base = context.parentURL ?? pathToFileURL(`${process.cwd()}/`).href;
      const resolvedBase = new URL(specifier, base);
      const basePath = fileURLToPath(resolvedBase);
      for (const suffix of CANDIDATE_SUFFIXES) {
        const candidate = basePath + suffix;
        if (existsSync(candidate)) {
          return nextResolve(pathToFileURL(candidate).href, context);
        }
      }
      throw err;
    }
  }
  return nextResolve(specifier, context);
}
