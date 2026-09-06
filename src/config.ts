import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1, 'DISCORD_BOT_TOKEN is required in .env'),
  DISCORD_CLIENT_ID: z.string().optional(),
  OPENROUTER_API_KEYS: z.string().min(1, 'OPENROUTER_API_KEYS is required in .env'),
  DEFAULT_TEXT_MODEL: z.string().optional().default(''),
  DEFAULT_VISION_MODEL: z.string().optional().default(''),
  MODEL_FETCH_INTERVAL_HOURS: z.coerce.number().positive().default(6),
  RATE_LIMIT_USER_MAX_REQUESTS: z.coerce.number().positive().default(5),
  RATE_LIMIT_USER_WINDOW_SECONDS: z.coerce.number().positive().default(60),
  RATE_LIMIT_CHANNEL_MAX_REQUESTS: z.coerce.number().positive().default(15),
  RATE_LIMIT_CHANNEL_WINDOW_SECONDS: z.coerce.number().positive().default(60),
  INJECTION_DEFENSE_LEVEL: z.enum(['strict', 'high', 'moderate']).default('high'),
  ENABLE_WEB_SEARCH: z.preprocess((val) => val === 'true' || val === true || val === '1', z.boolean()).default(true),
  SEARXNG_CUSTOM_URL: z.string().optional().default(''),
  PARSE_ACT_TOKENS: z.enum(['badges', 'clean', 'raw']).default('badges'),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('[CONFIG] Configuration error in environment variables:');
  console.error(JSON.stringify(parsedEnv.error.format(), null, 2));
}

export const config = parsedEnv.success
  ? {
      ...parsedEnv.data,
      openRouterApiKeys: parsedEnv.data.OPENROUTER_API_KEYS.split(',').map((k) => k.trim()).filter(Boolean),
    }
  : {
      DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN || '',
      DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID || '',
      OPENROUTER_API_KEYS: process.env.OPENROUTER_API_KEYS || '',
      openRouterApiKeys: (process.env.OPENROUTER_API_KEYS || '').split(',').map((k) => k.trim()).filter(Boolean),
      DEFAULT_TEXT_MODEL: process.env.DEFAULT_TEXT_MODEL || '',
      DEFAULT_VISION_MODEL: process.env.DEFAULT_VISION_MODEL || '',
      MODEL_FETCH_INTERVAL_HOURS: 6,
      RATE_LIMIT_USER_MAX_REQUESTS: 5,
      RATE_LIMIT_USER_WINDOW_SECONDS: 60,
      RATE_LIMIT_CHANNEL_MAX_REQUESTS: 15,
      RATE_LIMIT_CHANNEL_WINDOW_SECONDS: 60,
      INJECTION_DEFENSE_LEVEL: 'high' as const,
      ENABLE_WEB_SEARCH: true,
      SEARXNG_CUSTOM_URL: '',
      PARSE_ACT_TOKENS: 'badges' as const,
    };

