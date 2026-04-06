import { collapseWhitespace } from "../util/text.js";

const AI_TOOLING_PATTERNS = [
  /\bopenai\b/i,
  /\bchatgpt\b/i,
  /\bgpt(-|\s)?\d/i,
  /\bclaude\b/i,
  /\banthropic\b/i,
  /\bgoogle ai\b|\bgemini\b|\bdeepmind\b/i,
  /\bmeta ai\b|\bllama\b/i,
  /\bmistral\b|\bxai\b|\bgrok\b/i,
  /\bai\b|\bartificial intelligence\b/i,
  /\blm\b|\bllm\b|\bfoundation model\b/i,
  /\bagent(s|ic)?\b/i,
  /\bcoding agent\b/i,
  /\bmodel context protocol\b|\bmcp\b/i,
  /\bbrowser automation\b|\bcomputer use\b/i,
  /\btool use\b|\btool calling\b/i,
  /\borchestration\b|\bevals?\b|\bbenchmark\b/i,
  /\bdeveloper tooling\b|\bsdk\b|\bframework\b|\bcli\b/i,
  /\bsafety\b|\bsecurity\b|\bprompt injection\b/i,
  /\bvector\b|\brag\b|\binference\b|\bfine-tun/i,
  /\bplaywright\b|\bautomation\b/i,
  /\bgithub copilot\b|\bcodex\b/i
];

export function isAiToolingRelevantText(...values: Array<string | undefined | null>): boolean {
  const text = collapseWhitespace(values.filter(Boolean).join(" "));
  if (!text) {
    return false;
  }

  return AI_TOOLING_PATTERNS.some((pattern) => pattern.test(text));
}
