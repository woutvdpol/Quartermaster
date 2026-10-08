"use strict";

/*
 * Stand-in for node-fetch v2, wired in through `overrides` in package.json.
 *
 * Only @mollie/api-client depends on node-fetch (still v2 in its latest release). node-fetch v2
 * parses every request URL with the legacy `url.parse()`, which makes Node print DEP0169 on each
 * Mollie call. Node's built-in fetch (undici) covers everything the Mollie client uses: string/URL
 * input, method/headers/body, `response.status`, `.text()` and `.headers.get()`.
 *
 * The one option it does not understand is node-fetch's `agent`. Mollie passes an https.Agent that
 * only carries its own CA bundle; built-in fetch verifies against Node's bundled Mozilla roots,
 * which include the CAs api.mollie.com uses. The agent is dropped rather than forwarded.
 */

function fetch(input, init) {
  if (init && typeof init === "object" && "agent" in init) {
    const rest = { ...init };
    delete rest.agent;
    return globalThis.fetch(input, rest);
  }
  return globalThis.fetch(input, init);
}

module.exports = fetch;
module.exports.default = fetch;
module.exports.Headers = globalThis.Headers;
module.exports.Request = globalThis.Request;
module.exports.Response = globalThis.Response;
