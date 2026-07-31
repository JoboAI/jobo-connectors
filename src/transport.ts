export interface TransportRequest {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  /** Already-serialised JSON body, or undefined for GET. */
  body?: string;
  /** Milliseconds. Transports that cannot honour this may ignore it. */
  timeoutMs: number;
}

export interface TransportResponse {
  status: number;
  /** Header names MUST be lower-cased by the transport. */
  headers: Record<string, string>;
  body: string;
}

/**
 * The one seam every host platform plugs into.
 *
 * Deliberately not `fetch` itself: Apps Script has no fetch (only the
 * synchronous `UrlFetchApp`), and n8n's verified-node rules push you towards
 * `this.helpers.httpRequest` rather than a bundled HTTP client. Both satisfy
 * this interface in a dozen lines.
 *
 * There is deliberately NO default transport in this package. A `fetch`-based
 * one needs the timer globals for its abort timer, and because the default
 * would be referenced statically from `JoboClient`'s constructor no bundler
 * could tree-shake it away — every consumer would inline those globals even
 * when injecting its own transport. n8n's verified-node scanner bans them
 * outright (`@n8n/community-nodes/no-restricted-globals`), so the host always
 * supplies the transport, and with it the timer policy.
 */
export interface Transport {
  request(req: TransportRequest): Promise<TransportResponse>;
}
