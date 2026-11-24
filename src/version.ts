/**
 * This package's version, for the default User-Agent.
 *
 * A constant rather than an import of package.json: the package is inlined
 * into other bundles, and a JSON import would drag the whole manifest in with
 * it. `client.test.ts` fails when this and package.json disagree.
 */
export const VERSION = "0.6.0";
