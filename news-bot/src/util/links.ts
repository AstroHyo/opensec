export type ExternalLinkStyle = "plain" | "discord_safe";

export function formatExternalLink(url: string, style: ExternalLinkStyle = "plain"): string {
  const trimmed = url.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (style === "discord_safe") {
    const unwrapped = trimmed.replace(/^<+/, "").replace(/>+$/, "");
    return `<${unwrapped}>`;
  }

  return trimmed;
}
