// Content negotiation for articles: a client that asks for Markdown
// (Accept: text/markdown) gets the article source instead of the HTML page.
// Runs only when the Accept header mentions text/markdown, so browsers never
// reach it. Each article is also built as <article URL>index.md.
import type { Config, Context } from "@netlify/edge-functions";

// q-value of a media type in an Accept header; undefined when absent.
function quality(accept: string, type: string): number | undefined {
  for (const part of accept.split(",")) {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    if (name.trim() !== type) continue;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    const value = q ? Number(q.slice(2)) : 1;
    return Number.isNaN(value) ? 0 : value;
  }
  return undefined;
}

export default async (request: Request, context: Context) => {
  const accept = request.headers.get("accept") || "";
  const markdown = quality(accept, "text/markdown") ?? 0;
  // HTML's weight: its own entry, else the wildcards that cover it.
  const html =
    quality(accept, "text/html") ??
    quality(accept, "text/*") ??
    quality(accept, "*/*") ??
    0;
  const url = new URL(request.url);

  // HTML stays the answer when it is preferred, and for anything that is not
  // an article page.
  if (
    markdown === 0 ||
    markdown < html ||
    !url.pathname.endsWith("/")
  ) {
    return context.next();
  }

  const source = await fetch(new URL(url.pathname + "index.md", url), {
    method: request.method,
  });
  if (!source.ok) return context.next();

  return new Response(source.body, {
    status: 200,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "vary": "Accept",
      "x-robots-tag": "noindex",
      "x-content-type-options": "nosniff",
      "link": `<${url.origin}${url.pathname}>; rel="canonical"`,
    },
  });
};

export const config: Config = {
  path: "/articles/*",
  excludedPath: "/articles/",
  // GET only: Netlify rejects HEAD here (GET, POST, PUT, PATCH, DELETE, OPTIONS).
  method: "GET",
  // Only requests that mention Markdown reach the function.
  header: { accept: ".*text/markdown.*" },
  onError: "bypass",
};
