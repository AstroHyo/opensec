import { z } from "zod";
import { collapseWhitespace } from "../util/text.js";

interface StructuredJsonRequest<T> {
  apiKey: string;
  model: string;
  schemaName: string;
  schema: Record<string, unknown>;
  validator: z.ZodType<T>;
  systemPrompt: string;
  userPrompt: string;
  timeoutMs: number;
}

export interface StructuredJsonResponse<T> {
  data: T;
  usage?: Record<string, unknown> | null;
}

export interface StructuredJsonResponseWithAnnotations<T> extends StructuredJsonResponse<T> {
  annotations: Array<{ url: string; title?: string }>;
}

export async function generateStructuredJson<T>(input: StructuredJsonRequest<T>): Promise<StructuredJsonResponse<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.apiKey}`
      },
      body: JSON.stringify({
        model: input.model,
        temperature: 0.2,
        messages: [
          { role: "system", content: input.systemPrompt },
          { role: "user", content: input.userPrompt }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: input.schemaName,
            strict: true,
            schema: input.schema
          }
        }
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI request failed: ${response.status} ${await response.text()}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | Array<{ type?: string; text?: string }>;
          refusal?: string;
        };
      }>;
      usage?: Record<string, unknown>;
    };

    const choice = payload.choices?.[0];
    if (!choice?.message) {
      throw new Error("OpenAI response did not contain a message");
    }

    if (choice.message.refusal) {
      throw new Error(`OpenAI refused the request: ${choice.message.refusal}`);
    }

    const content = extractContent(choice.message.content);
    if (!content) {
      throw new Error("OpenAI response did not contain structured JSON text");
    }

    const parsed = input.validator.parse(JSON.parse(content));
    return {
      data: parsed,
      usage: payload.usage ?? null
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateStructuredJsonWithWebSearch<T>(
  input: StructuredJsonRequest<T>
): Promise<StructuredJsonResponseWithAnnotations<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.apiKey}`
      },
      body: JSON.stringify({
        model: input.model,
        instructions: input.systemPrompt,
        input: input.userPrompt,
        tools: [{ type: "web_search" }],
        text: {
          format: {
            type: "json_schema",
            name: input.schemaName,
            strict: true,
            schema: input.schema
          }
        },
        store: false
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI Responses request failed: ${response.status} ${await response.text()}`);
    }

    const payload = (await response.json()) as {
      output_text?: string;
      output?: Array<{
        content?: Array<{
          type?: string;
          text?: string;
          annotations?: Array<{ url?: string; title?: string }>;
        }>;
      }>;
      usage?: Record<string, unknown>;
      error?: { message?: string };
    };

    if (payload.error?.message) {
      throw new Error(payload.error.message);
    }

    const content = extractResponsesContent(payload);
    if (!content.text) {
      throw new Error("OpenAI Responses API did not return structured JSON text");
    }

    const parsed = input.validator.parse(JSON.parse(content.text));
    return {
      data: parsed,
      usage: payload.usage ?? null,
      annotations: content.annotations
    };
  } finally {
    clearTimeout(timeout);
  }
}

function extractContent(content?: string | Array<{ type?: string; text?: string }>): string {
  if (typeof content === "string") {
    return collapseWhitespace(content);
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return collapseWhitespace(
    content
      .map((part) => (part?.type === "text" || typeof part?.text === "string" ? part.text ?? "" : ""))
      .join(" ")
  );
}

function extractResponsesContent(payload: {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
      annotations?: Array<{ url?: string; title?: string }>;
    }>;
  }>;
}): { text: string; annotations: Array<{ url: string; title?: string }> } {
  if (typeof payload.output_text === "string" && payload.output_text.trim().length > 0) {
    return {
      text: collapseWhitespace(payload.output_text),
      annotations: collectAnnotations(payload.output)
    };
  }

  const parts =
    payload.output
      ?.flatMap((message) => message.content ?? [])
      .filter((part) => typeof part?.text === "string" && part.text.trim().length > 0)
      .map((part) => part.text ?? "") ?? [];

  return {
    text: collapseWhitespace(parts.join(" ")),
    annotations: collectAnnotations(payload.output)
  };
}

function collectAnnotations(
  output?: Array<{
    content?: Array<{
      annotations?: Array<{ url?: string; title?: string }>;
    }>;
  }>
): Array<{ url: string; title?: string }> {
  const seen = new Set<string>();
  const collected: Array<{ url: string; title?: string }> = [];

  for (const message of output ?? []) {
    for (const part of message.content ?? []) {
      for (const annotation of part.annotations ?? []) {
        const url = annotation.url?.trim();
        if (!url || seen.has(url)) {
          continue;
        }
        seen.add(url);
        collected.push({
          url,
          title: annotation.title?.trim() || undefined
        });
      }
    }
  }

  return collected;
}
