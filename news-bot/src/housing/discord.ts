export async function sendDiscordDirectMessage(input: {
  token: string;
  userId: string;
  content: string;
}): Promise<{ channelId: string; messageId: string }> {
  const dmChannel = await discordRequest<{
    id: string;
  }>({
    token: input.token,
    method: "POST",
    path: "/users/@me/channels",
    body: {
      recipient_id: input.userId
    }
  });

  const message = await discordRequest<{
    id: string;
  }>({
    token: input.token,
    method: "POST",
    path: `/channels/${dmChannel.id}/messages`,
    body: {
      content: input.content
    }
  });

  return {
    channelId: dmChannel.id,
    messageId: message.id
  };
}

async function discordRequest<T>(input: {
  token: string;
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
}): Promise<T> {
  const response = await fetch(`https://discord.com/api/v10${input.path}`, {
    method: input.method,
    headers: {
      authorization: `Bot ${input.token}`,
      "content-type": "application/json"
    },
    body: input.body ? JSON.stringify(input.body) : undefined
  });

  if (!response.ok) {
    throw new Error(`Discord API request failed: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as T;
}
