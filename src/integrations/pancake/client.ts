const PANCAKE_API_BASE_URL = "https://pos.pages.fm/api/v1";

type QueryValue = string | number | boolean;
type Fetcher = typeof fetch;

export class PancakeHttpError extends Error {
  readonly status: number;
  readonly endpoint: string;

  constructor(status: number, endpoint: string) {
    super(`Pancake request failed with status ${status} for ${endpoint}`);
    this.name = "PancakeHttpError";
    this.status = status;
    this.endpoint = endpoint;
  }
}

export class PancakeNetworkError extends Error {
  readonly endpoint: string;

  constructor(endpoint: string) {
    super(`Pancake request could not be completed for ${endpoint}`);
    this.name = "PancakeNetworkError";
    this.endpoint = endpoint;
  }
}

export class PancakeClient {
  private readonly apiKey: string;
  private readonly fetcher: Fetcher;

  constructor({ apiKey, fetcher = fetch }: { apiKey: string; fetcher?: Fetcher }) {
    if (!apiKey.trim()) {
      throw new TypeError("Pancake API key is required");
    }

    this.apiKey = apiKey;
    this.fetcher = fetcher;
  }

  async getJson(endpoint: string, query: Readonly<Record<string, QueryValue>> = {}): Promise<unknown> {
    const url = this.buildUrl(endpoint, query);
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: "GET",
        headers: { accept: "application/json" },
      });
    } catch {
      throw new PancakeNetworkError(endpoint);
    }

    if (!response.ok) {
      throw new PancakeHttpError(response.status, endpoint);
    }

    return response.json() as Promise<unknown>;
  }

  private buildUrl(endpoint: string, query: Readonly<Record<string, QueryValue>>): URL {
    if (
      !endpoint.startsWith("/") ||
      endpoint.startsWith("//") ||
      endpoint.includes("..") ||
      endpoint.includes("\\") ||
      endpoint.includes("?") ||
      endpoint.includes("#")
    ) {
      throw new TypeError("Pancake endpoint must start with / and contain only a path");
    }

    const url = new URL(`${PANCAKE_API_BASE_URL}${endpoint}`);
    url.searchParams.set("api_key", this.apiKey);

    for (const [key, value] of Object.entries(query)) {
      if (key === "api_key") {
        continue;
      }
      url.searchParams.set(key, String(value));
    }

    return url;
  }
}
