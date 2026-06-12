// PHA-925 — registers the extensionless-import resolver hook (ts-resolve-hook.mjs)
// for the offline verify-*.ts harness. Pass to node via `--import`:
//
//   node --experimental-strip-types --import ./scripts/register-ts-resolve.mjs \
//        --no-warnings scripts/verify-<name>.ts
//
// Or run the whole suite through scripts/verify-all.mjs.
import { register } from "node:module";

register("./ts-resolve-hook.mjs", import.meta.url);
