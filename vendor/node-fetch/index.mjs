// ESM entry of the node-fetch stand-in; see index.js for why it exists.
import fetch from "./index.js";

export default fetch;
export const Headers = globalThis.Headers;
export const Request = globalThis.Request;
export const Response = globalThis.Response;
