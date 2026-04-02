import "dotenv/config";
import { runFollowupCommand } from "./commands/followup.js";
import { runDigestFlow, runFetchOnly } from "./commands/runDigest.js";

async function main(): Promise<void> {
  const [command = "digest", ...args] = process.argv.slice(2);
  const options = parseOptions(args);

  if (command === "digest") {
    const { digest, db } = await runDigestFlow({
      mode: (getStringOption(options, "mode") as "am" | "pm" | "manual") ?? "manual",
      nowIso: getStringOption(options, "now"),
      dbPathOverride: getStringOption(options, "db"),
      skipFetch: getBooleanOption(options, "skip-fetch"),
      fixturePath: getStringOption(options, "seed-fixture"),
      resetDb: getBooleanOption(options, "reset-db")
    });
    console.log(digest.bodyText);
    db.close();
    return;
  }

  if (command === "followup") {
    const commandText = options._.join(" ").trim();
    if (!commandText) {
      throw new Error("followup command text is required");
    }
    console.log(
      await runFollowupCommand({
        command: commandText,
        nowIso: getStringOption(options, "now"),
        dbPathOverride: getStringOption(options, "db")
      })
    );
    return;
  }

  if (command === "fetch") {
    const { db } = await runFetchOnly({
      nowIso: getStringOption(options, "now"),
      dbPathOverride: getStringOption(options, "db"),
      resetDb: getBooleanOption(options, "reset-db")
    });
    console.log("Fetched and stored latest source data.");
    db.close();
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

type ParsedOptions = Record<string, string | boolean | string[]>;

function parseOptions(argv: string[]): ParsedOptions & { _: string[] } {
  const values: ParsedOptions & { _: string[] } = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      (values._ as string[]).push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      values[key] = true;
      continue;
    }

    values[key] = next;
    index += 1;
  }

  return values;
}

function getStringOption(options: ParsedOptions, key: string): string | undefined {
  const value = options[key];
  return typeof value === "string" ? value : undefined;
}

function getBooleanOption(options: ParsedOptions, key: string): boolean {
  return options[key] === true;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
