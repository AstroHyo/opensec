import path from "node:path";
import { z } from "zod";
import { resolveProfileKey } from "./profiles.js";
import { BLUESKY_WATCHLIST } from "./sources/blueskyWatchlist.js";
import type { BlueskyWatchActor, ProfileKey } from "./types.js";

const envSchema = z.object({
  NEWS_BOT_TIMEZONE: z.string().default("America/New_York"),
  NEWS_BOT_LANGUAGE: z.string().default("ko"),
  NEWS_BOT_DB_PATH: z.string().default("./data/news-bot.sqlite"),
  NEWS_BOT_DEFAULT_PROFILE: z.string().default("tech"),
  NEWS_BOT_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  NEWS_BOT_XHS_PROFILE_DIR: z.string().default("./data/xhs-profile"),
  NEWS_BOT_XHS_HEADLESS: z
    .string()
    .optional()
    .transform((value) => (value == null ? false : !(value === "0" || value === "false"))),
  NEWS_BOT_XHS_VISION_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "1" || value === "true"),
  NEWS_BOT_XHS_MAX_RESULTS_PER_QUERY: z.coerce.number().int().positive().default(12),
  NEWS_BOT_TELEGRAM_USER_ID: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  DISCORD_BOT_TOKEN: z.string().optional(),
  DISCORD_OWNER_USER_ID: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  XAI_API_KEY: z.string().optional(),
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
  NEWS_BOT_LLM_MODEL_TIER_SMALL: z.string().default("xai:grok-4-1-fast-reasoning"),
  NEWS_BOT_LLM_MODEL_TIER_MEDIUM: z.string().default("openai:gpt-4.1"),
  NEWS_BOT_LLM_MODEL_TIER_DEEP: z.string().default("openai:gpt-5.4-mini"),
  NEWS_BOT_LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  NEWS_BOT_LLM_TIMEOUT_TIER_SMALL_MS: z.coerce.number().int().positive().default(20_000),
  NEWS_BOT_LLM_TIMEOUT_TIER_MEDIUM_MS: z.coerce.number().int().positive().default(30_000),
  NEWS_BOT_LLM_TIMEOUT_TIER_DEEP_MS: z.coerce.number().int().positive().default(60_000),
  NEWS_BOT_LLM_MAX_ITEMS_AM: z.coerce.number().int().positive().default(12),
  NEWS_BOT_LLM_MAX_ITEMS_PM: z.coerce.number().int().positive().default(20),
  NEWS_BOT_LLM_MAX_ALLOWED_TIER: z.coerce.number().int().min(0).max(3).default(3),
  NEWS_BOT_LLM_DAILY_BUDGET_USD: z
    .union([z.string().length(0), z.coerce.number().positive()])
    .optional()
    .transform((value) => (typeof value === "number" ? value : undefined)),
  NEWS_BOT_LLM_BUDGET_HARD_STOP: z
    .string()
    .optional()
    .transform((value) => value === "1" || value === "true"),
  NEWS_BOT_BLUESKY_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "1" || value === "true"),
  NEWS_BOT_SIGNAL_WINDOW_HOURS: z.coerce.number().int().positive().default(48),
  NEWS_BOT_HN_TOP_LIMIT: z.coerce.number().int().positive().default(18),
  NEWS_BOT_HN_NEW_LIMIT: z.coerce.number().int().positive().default(12),
  NEWS_BOT_BLUESKY_MAX_POSTS_PER_ACTOR: z.coerce.number().int().positive().default(10)
});

export interface AppConfig {
  projectRoot: string;
  timezone: string;
  language: string;
  dbPath: string;
  defaultProfile: ProfileKey;
  httpTimeoutMs: number;
  telegramUserId?: string;
  telegramBotToken?: string;
  discordBotToken?: string;
  discordOwnerUserId?: string;
  openAiApiKey?: string;
  xAiApiKey?: string;
  llm: {
    enabled: boolean;
    themesEnabled: boolean;
    rerankEnabled: boolean;
    modelTierSmall: string;
    modelTierMedium: string;
    modelTierDeep: string;
    timeoutMs: number;
    timeoutTierSmallMs: number;
    timeoutTierMediumMs: number;
    timeoutTierDeepMs: number;
    maxItemsAm: number;
    maxItemsPm: number;
    maxAllowedTier: 0 | 1 | 2 | 3;
    dailyBudgetUsd?: number;
    budgetHardStop: boolean;
  };
  sourcing: {
    blueskyEnabled: boolean;
    signalWindowHours: number;
    hnTopLimit: number;
    hnNewLimit: number;
    blueskyMaxPostsPerActor: number;
    blueskyWatchlist: BlueskyWatchActor[];
  };
  housingWatcher: {
    profileDir: string;
    headless: boolean;
    visionEnabled: boolean;
    maxResultsPerQuery: number;
  };
  sourceUrls: {
    geeknewsRss: string;
    openaiNewsRss: string;
    fedPressRss: string;
    secPressRss: string;
    treasuryPressPage: string;
    blsReleasePages: Array<{ key: "bls_cpi" | "bls_jobs" | "bls_ppi" | "bls_eci"; label: string; url: string }>;
    openaiSections: Array<{ label: string; url: string }>;
    githubTrending: Array<{ label: string; url: string }>;
    techmemeHome: string;
    hackerNewsApiBase: string;
    blueskyApiBase: string;
  };
  financeCompanies: Array<{ name: string; ticker: string; cik: string }>;
}

export function loadConfig(cwd = process.cwd()): AppConfig {
  const env = envSchema.parse(process.env);
  const projectRoot = cwd;

  return {
    projectRoot,
    timezone: env.NEWS_BOT_TIMEZONE,
    language: env.NEWS_BOT_LANGUAGE,
    dbPath: path.resolve(projectRoot, env.NEWS_BOT_DB_PATH),
    defaultProfile: resolveProfileKey(env.NEWS_BOT_DEFAULT_PROFILE),
    httpTimeoutMs: env.NEWS_BOT_HTTP_TIMEOUT_MS,
    telegramUserId: env.NEWS_BOT_TELEGRAM_USER_ID,
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    discordBotToken: env.DISCORD_BOT_TOKEN,
    discordOwnerUserId: env.DISCORD_OWNER_USER_ID,
    openAiApiKey: env.OPENAI_API_KEY,
    xAiApiKey: env.XAI_API_KEY,
    llm: {
      enabled: Boolean((env.OPENAI_API_KEY || env.XAI_API_KEY) && env.NEWS_BOT_LLM_ENABLED),
      themesEnabled: Boolean((env.OPENAI_API_KEY || env.XAI_API_KEY) && env.NEWS_BOT_LLM_THEMES_ENABLED),
      rerankEnabled: Boolean((env.OPENAI_API_KEY || env.XAI_API_KEY) && env.NEWS_BOT_LLM_RERANK_ENABLED),
      modelTierSmall: env.NEWS_BOT_LLM_MODEL_TIER_SMALL,
      modelTierMedium: env.NEWS_BOT_LLM_MODEL_TIER_MEDIUM,
      modelTierDeep: env.NEWS_BOT_LLM_MODEL_TIER_DEEP,
      timeoutMs: env.NEWS_BOT_LLM_TIMEOUT_MS,
      timeoutTierSmallMs: env.NEWS_BOT_LLM_TIMEOUT_TIER_SMALL_MS,
      timeoutTierMediumMs: env.NEWS_BOT_LLM_TIMEOUT_TIER_MEDIUM_MS,
      timeoutTierDeepMs: env.NEWS_BOT_LLM_TIMEOUT_TIER_DEEP_MS,
      maxItemsAm: env.NEWS_BOT_LLM_MAX_ITEMS_AM,
      maxItemsPm: env.NEWS_BOT_LLM_MAX_ITEMS_PM,
      maxAllowedTier: env.NEWS_BOT_LLM_MAX_ALLOWED_TIER as 0 | 1 | 2 | 3,
      dailyBudgetUsd: env.NEWS_BOT_LLM_DAILY_BUDGET_USD,
      budgetHardStop: Boolean(env.NEWS_BOT_LLM_BUDGET_HARD_STOP)
    },
    sourcing: {
      blueskyEnabled: Boolean(env.NEWS_BOT_BLUESKY_ENABLED),
      signalWindowHours: env.NEWS_BOT_SIGNAL_WINDOW_HOURS,
      hnTopLimit: env.NEWS_BOT_HN_TOP_LIMIT,
      hnNewLimit: env.NEWS_BOT_HN_NEW_LIMIT,
      blueskyMaxPostsPerActor: env.NEWS_BOT_BLUESKY_MAX_POSTS_PER_ACTOR,
      blueskyWatchlist: BLUESKY_WATCHLIST
    },
    housingWatcher: {
      profileDir: path.resolve(projectRoot, env.NEWS_BOT_XHS_PROFILE_DIR),
      headless: env.NEWS_BOT_XHS_HEADLESS,
      visionEnabled: Boolean(env.NEWS_BOT_XHS_VISION_ENABLED),
      maxResultsPerQuery: env.NEWS_BOT_XHS_MAX_RESULTS_PER_QUERY
    },
    sourceUrls: {
      geeknewsRss: "https://news.hada.io/rss/news",
      openaiNewsRss: "https://openai.com/news/rss.xml",
      fedPressRss: "https://www.federalreserve.gov/feeds/press_all.xml",
      secPressRss: "https://www.sec.gov/news/pressreleases.rss",
      treasuryPressPage: "https://home.treasury.gov/news/press-releases",
      blsReleasePages: [
        { key: "bls_cpi", label: "BLS / CPI", url: "https://www.bls.gov/news.release/cpi.toc.htm" },
        { key: "bls_jobs", label: "BLS / Jobs", url: "https://www.bls.gov/news.release/empsit.toc.htm" },
        { key: "bls_ppi", label: "BLS / PPI", url: "https://www.bls.gov/news.release/ppi.toc.htm" },
        { key: "bls_eci", label: "BLS / ECI", url: "https://www.bls.gov/news.release/eci.toc.htm" }
      ],
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
      ],
      techmemeHome: "https://www.techmeme.com",
      hackerNewsApiBase: "https://hacker-news.firebaseio.com/v0",
      blueskyApiBase: "https://public.api.bsky.app/xrpc"
    },
    financeCompanies: [
      { name: "Apple", ticker: "AAPL", cik: "0000320193" },
      { name: "Microsoft", ticker: "MSFT", cik: "0000789019" },
      { name: "Alphabet", ticker: "GOOGL", cik: "0001652044" },
      { name: "Amazon", ticker: "AMZN", cik: "0001018724" },
      { name: "Meta", ticker: "META", cik: "0001326801" },
      { name: "NVIDIA", ticker: "NVDA", cik: "0001045810" },
      { name: "Tesla", ticker: "TSLA", cik: "0001318605" }
    ]
  };
}
