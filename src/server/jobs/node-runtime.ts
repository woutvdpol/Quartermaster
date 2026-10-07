// Prepares a plain Node.js process (the worker, scripts) to load server modules written for Next.js.
//
// `server-only` throws unless resolved with the "react-server" condition. We cannot run the worker
// with `--conditions=react-server`, because `react-dom/server` (used by React Email rendering) refuses
// to load under that condition. Instead redirect just `server-only` to its no-op entry.
//
// Must be imported before any server module, and app modules must then be loaded with dynamic
// `import()` (static imports may be linked before this runs).
import { registerHooks } from "node:module";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(path.join(process.cwd(), "package.json"));
const emptyUrl = pathToFileURL(path.join(path.dirname(require.resolve("server-only")), "empty.js")).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: emptyUrl, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
