import { Client, GatewayIntentBits, Partials, ActivityType } from 'discord.js';
import { handleMessage } from './handlers/messageHandler.js';
import { ProviderConsole } from './console/providerConsole.js';
import { config } from '../config.js';

export function createDiscordClient(): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel, Partials.Message],
  });

  client.once('ready', (c) => {
    console.log(`[BOT] Logged in successfully as [${c.user.tag}]`);
    console.log(`[BOT] Client ID: ${c.user.id}`);
    console.log(`[BOT] Status: Ready to receive events`);

    c.user.setActivity('humming server fans in life pod nya~', {
      type: ActivityType.Listening,
    });
  });

  client.on('messageCreate', async (message) => {
    try {
      await handleMessage(message, client);
    } catch (err: any) {
      console.error('[ERROR] Unhandled message error:', err);
    }
  });

  client.on('interactionCreate', async (interaction) => {
    try {
      await ProviderConsole.getInstance().handleInteraction(interaction);
    } catch (err: any) {
      console.error('[ERROR] Unhandled interaction error:', err);
    }
  });

  client.on('error', (error) => {
    console.error('[ERROR] Discord client error:', error);
  });

  return client;
}

export async function startBot(client: Client): Promise<void> {
  if (!config.DISCORD_BOT_TOKEN) {
    throw new Error('DISCORD_BOT_TOKEN is not set in .env. Please configure it to start the bot.');
  }

  await client.login(config.DISCORD_BOT_TOKEN);
}

