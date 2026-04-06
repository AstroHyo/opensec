export async function fetchText(
  url: string,
  timeoutMs: number,
  headers?: Record<string, string>
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "openclaw-ai-news-brief/0.1 (+https://github.com/openclaw)",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...headers
      },
      redirect: "follow",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchJson<T>(
  url: string,
  timeoutMs: number,
  headers?: Record<string, string>
): Promise<T> {
  const text = await fetchText(url, timeoutMs, {
    accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
    ...headers
  });

  return JSON.parse(text) as T;
}
