// Lets CLI scripts (seed, ETL, worker) import app modules guarded by `import "server-only"`.
// That package throws outside React Server Components; for trusted server-side scripts it is a no-op.
import { registerHooks } from "node:module";

const empty = new URL("./empty-module.cjs", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: empty, format: "commonjs", shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
