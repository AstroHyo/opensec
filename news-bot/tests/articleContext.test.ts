import { describe, expect, it } from "vitest";
import { extractArticleContextFromHtml } from "../src/evidence/articleContext.js";
import type { DigestEntry } from "../src/types.js";

describe("article context extraction", () => {
  it("extracts body context from a generic article page", () => {
    const item: DigestEntry = {
      profileKey: "tech",
      number: 1,
      itemId: 1,
      sectionKey: "candidate_pool",
      sourceType: "openai_official",
      itemKind: "product",
      title: "OpenAI product release",
      summary: "summary",
      whyImportant: "why",
      primaryUrl: "https://openai.com/news/example",
      sourceLabel: "OpenAI / Product Releases",
      score: 90,
      scoreReasons: ["reason"],
      sourceLinks: [{ label: "OpenAI", url: "https://openai.com/news/example" }],
      keywords: ["OpenAI", "agents"],
      metadata: {}
    };

    const html = `
      <html>
        <head>
          <meta property="og:title" content="OpenAI launches a new Responses API capability" />
          <meta property="og:description" content="The release adds computer use primitives for multi-step tasks." />
          <meta property="og:site_name" content="OpenAI" />
          <meta name="author" content="OpenAI" />
        </head>
        <body>
          <article>
            <h1>OpenAI launches a new Responses API capability</h1>
            <p>The release adds computer use primitives for multi-step tasks in the Responses API.</p>
            <p>Developers can now chain browsing, tool use, and execution into a single workflow.</p>
            <p>This changes how eval harnesses and orchestrators need to reason about state and permissions.</p>
          </article>
        </body>
      </html>
    `;

    const context = extractArticleContextFromHtml({
      item,
      html,
      canonicalUrl: item.primaryUrl
    });

    expect(context.fetchStatus).toBe("ok");
    expect(context.publisher).toBe("OpenAI");
    expect(context.headline).toContain("Responses API");
    expect(context.cleanText).toContain("computer use primitives");
    expect(context.evidenceSnippets.length).toBeGreaterThan(0);
  });

  it("extracts README context from a GitHub repo page", () => {
    const item: DigestEntry = {
      profileKey: "tech",
      number: 1,
      itemId: 2,
      sectionKey: "candidate_pool",
      sourceType: "github_trending",
      itemKind: "repo",
      title: "acme/agent-runner",
      summary: "summary",
      whyImportant: "why",
      primaryUrl: "https://github.com/acme/agent-runner",
      sourceLabel: "GitHub Trending / overall",
      score: 88,
      scoreReasons: ["reason"],
      sourceLinks: [{ label: "GitHub", url: "https://github.com/acme/agent-runner" }],
      repoLanguage: "TypeScript",
      repoStarsToday: 321,
      keywords: ["agents", "MCP"],
      metadata: {}
    };

    const html = `
      <html>
        <head>
          <meta property="og:title" content="acme/agent-runner" />
          <meta property="og:description" content="Agent runtime for browser automation and MCP." />
        </head>
        <body>
          <div id="readme">
            <article class="markdown-body">
              <p>Agent Runner is a TypeScript runtime for browser automation, MCP routing, and eval capture.</p>
              <p>It provides durable state, execution tracing, and replay for multi-step coding agents.</p>
            </article>
          </div>
        </body>
      </html>
    `;

    const context = extractArticleContextFromHtml({
      item,
      html,
      canonicalUrl: item.primaryUrl
    });

    expect(context.publisher).toBe("GitHub");
    expect(context.cleanText).toContain("browser automation");
    expect(context.evidenceSnippets[0]).toContain("TypeScript runtime");
  });
});
