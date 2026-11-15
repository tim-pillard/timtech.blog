// Content negotiation for articles: a client that asks for Markdown
// (Accept: text/markdown) gets the article source instead of the HTML page.
// Runs only when the Accept header mentions text/markdown, so browsers never
// reach it. Each article is also built as <article URL>index.md.
import type { Config, Context } from "@netlify/edge-functions";

// q-value of a media type in an Accept header; 0 when absent.
function quality(accept: string, type: string): number {
  for (const part of accept.split(",")) {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    if (name.trim() !== type) continue;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    const value = q ? Number(q.slice(2)) : 1;
    return Number.isNaN(value) ? 0 : value;
  }
  return 0;
}

export default async (request: Request, context: Context) => {
  const accept = request.headers.get("accept") || "";
  const markdown = quality(accept, "text/markdown");
  const url = new URL(request.url);

  // HTML stays the answer when it is preferred, and for anything that is not
  // an article page.
  if (
    markdown === 0 ||
    markdown < quality(accept, "text/html") ||
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
      "link": `<${url.origin}${url.pathname}>; rel="canonical"`,
    },
  });
};

export const config: Config = {
  path: "/articles/*",
  method: ["GET", "HEAD"],
  header: { accept: ".*text/markdown.*" },
  onError: "bypass",
};
