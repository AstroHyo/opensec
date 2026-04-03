import path from "node:path";
import { z } from "zod";

const envSchema = z.object({
  NEWS_BOT_TIMEZONE: z.string().default("America/New_York"),
  NEWS_BOT_LANGUAGE: z.string().default("ko"),
  NEWS_BOT_DB_PATH: z.string().default("./data/news-bot.sqlite"),
  NEWS_BOT_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  NEWS_BOT_TELEGRAM_USER_ID: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  NEWS_BOT_LLM_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "1" || value === "true"),
  NEWS_BOT_LLM_THEMES_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "1" || value === "true"),
  NEWS_BOT_LLM_RERANK_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "1" || value === "true"),
  NEWS_BOT_LLM_MODEL_SUMMARY: z.string().default("gpt-4.1-mini"),
  NEWS_BOT_LLM_MODEL_THEMES: z.string().default("gpt-4.1"),
  NEWS_BOT_LLM_MODEL_RESEARCH: z.string().default("gpt-5.4-mini"),
  NEWS_BOT_LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  NEWS_BOT_LLM_MAX_ITEMS_AM: z.coerce.number().int().positive().default(12),
  NEWS_BOT_LLM_MAX_ITEMS_PM: z.coerce.number().int().positive().default(20)
});

export interface AppConfig {
  projectRoot: string;
  timezone: string;
  language: string;
  dbPath: string;
  httpTimeoutMs: number;
  telegramUserId?: string;
  telegramBotToken?: string;
  openAiApiKey?: string;
  llm: {
    enabled: boolean;
    themesEnabled: boolean;
    rerankEnabled: boolean;
    summaryModel: string;
    themesModel: string;
    researchModel: string;
    timeoutMs: number;
    maxItemsAm: number;
    maxItemsPm: number;
  };
  sourceUrls: {
    geeknewsRss: string;
    openaiNewsRss: string;
    openaiSections: Array<{ label: string; url: string }>;
    githubTrending: Array<{ label: string; url: string }>;
  };
}

export function loadConfig(cwd = process.cwd()): AppConfig {
  const env = envSchema.parse(process.env);
  const projectRoot = cwd;

  return {
    projectRoot,
    timezone: env.NEWS_BOT_TIMEZONE,
    language: env.NEWS_BOT_LANGUAGE,
    dbPath: path.resolve(projectRoot, env.NEWS_BOT_DB_PATH),
    httpTimeoutMs: env.NEWS_BOT_HTTP_TIMEOUT_MS,
    telegramUserId: env.NEWS_BOT_TELEGRAM_USER_ID,
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    openAiApiKey: env.OPENAI_API_KEY,
    llm: {
      enabled: Boolean(env.OPENAI_API_KEY && env.NEWS_BOT_LLM_ENABLED),
      themesEnabled: Boolean(env.OPENAI_API_KEY && env.NEWS_BOT_LLM_THEMES_ENABLED),
      rerankEnabled: Boolean(env.OPENAI_API_KEY && env.NEWS_BOT_LLM_RERANK_ENABLED),
      summaryModel: env.NEWS_BOT_LLM_MODEL_SUMMARY,
      themesModel: env.NEWS_BOT_LLM_MODEL_THEMES,
      researchModel: env.NEWS_BOT_LLM_MODEL_RESEARCH,
      timeoutMs: env.NEWS_BOT_LLM_TIMEOUT_MS,
      maxItemsAm: env.NEWS_BOT_LLM_MAX_ITEMS_AM,
      maxItemsPm: env.NEWS_BOT_LLM_MAX_ITEMS_PM
    },
    sourceUrls: {
      geeknewsRss: "https://news.hada.io/rss/news",
      openaiNewsRss: "https://openai.com/news/rss.xml",
      openaiSections: [
        { label: "OpenAI / Newsroom", url: "https://openai.com/news/" },
        { label: "OpenAI / Product Releases", url: "https://openai.com/news/product-releases/" },
        { label: "OpenAI / Research", url: "https://openai.com/news/research/" },
        { label: "OpenAI / Company Announcements", url: "https://openai.com/news/company-announcements/" }
      ],
      githubTrending: [
        { label: "GitHub Trending / overall", url: "https://github.com/trending" },
        { label: "GitHub Trending / python", url: "https://github.com/trending/python" },
        { label: "GitHub Trending / typescript", url: "https://github.com/trending/typescript" },
        { label: "GitHub Trending / javascript", url: "https://github.com/trending/javascript" },
        { label: "GitHub Trending / rust", url: "https://github.com/trending/rust" }
      ]
    }
  };
}
