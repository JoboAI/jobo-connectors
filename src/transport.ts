import { JoboTransportError } from "./errors";

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
 */
export interface Transport {
  request(req: TransportRequest): Promise<TransportResponse>;
}

function lowerCaseHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

/**
 * Default transport built on global `fetch` (Node >= 18, and every browser-ish
 * host). Uses AbortController for the timeout so a hung socket cannot wedge a
 * scheduled workflow run.
 */
export const fetchTransport: Transport = {
  async request(req: TransportRequest): Promise<TransportResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);

    try {
      const response = await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.body,
        signal: controller.signal,
      });

      return {
        status: response.status,
        headers: lowerCaseHeaders(response.headers),
        body: await response.text(),
      };
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") {
        throw new JoboTransportError(`Request to ${req.url} timed out after ${req.timeoutMs}ms`, cause);
      }
      throw new JoboTransportError(
        `Request to ${req.url} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
      );
    } finally {
      clearTimeout(timer);
    }
  },
};
