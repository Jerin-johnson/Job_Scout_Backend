/**
 * Allow the configured frontend origin everywhere. In non-production, also
 * allow equivalent loopback hostnames so localhost and 127.0.0.1 work locally.
 */
export function isTrustedWebOrigin(origin, config) {
  if (!origin || origin === config.WEB_ORIGIN) return true;
  if (config.NODE_ENV === "production") return false;

  try {
    const requested = new URL(origin);
    const configured = new URL(config.WEB_ORIGIN);
    const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

    return (
      requested.origin === origin &&
      requested.protocol === configured.protocol &&
      requested.port === configured.port &&
      loopbackHosts.has(requested.hostname) &&
      loopbackHosts.has(configured.hostname)
    );
  } catch {
    return false;
  }
}
