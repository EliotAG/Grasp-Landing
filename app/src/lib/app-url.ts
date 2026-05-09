export function getConfiguredAppBaseUrl(): string | null {
  const url =
    process.env.AUTH_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim();
  return url ? withoutTrailingSlash(url) : null;
}

export function getLocalAppBaseUrl(defaultPort = "3001"): string {
  const port = process.env.PORT?.trim() || defaultPort;
  return `http://localhost:${port}`;
}

export function getAppBaseUrlFromHeaders(
  headers: Headers,
  fallbackHost = "localhost:3000",
): string {
  const proto = headers.get("x-forwarded-proto") ?? "http";
  const host = headers.get("host") ?? fallbackHost;
  return `${proto}://${host}`;
}

export function absoluteAppUrl(baseUrl: string, path: `/${string}`): string {
  return `${withoutTrailingSlash(baseUrl)}${path}`;
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}
