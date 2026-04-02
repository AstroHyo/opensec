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
