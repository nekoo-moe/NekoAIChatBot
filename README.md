# NekoAI Discord Bot

> Intelligent Discord bot engine powered by **TypeScript**, featuring **OpenRouter free model auto-rotation**, multimodal **Vision** support, **real-time web search**, multi-layer defense against **Prompt Injection & Jailbreaks**, and optimized system instructions for the **NekoAI** persona.

---

## Features

### 1. OpenRouter Free Model Auto-Rotation
- **Dynamic Discovery:** Automatically connects to the OpenRouter API on startup and recurring intervals (default: 6 hours) to discover all models priced at `0` or suffixed with `:free`.
- **Modality Categorization:** Automatically segregates **Text Models** and **Vision Models** (image understanding).
- **Intelligent Fallback:** When encountering rate limits (HTTP 429), server overload (503), timeouts, or context length exceeded, the engine seamlessly fails over to the next available free model.
- **Key Rotation:** Supports configuring multiple OpenRouter API keys in `.env` (comma-separated) with automatic round-robin rotation upon encountering quota limits.

### 2. Multimodal Vision Support
- Direct processing of Discord image attachments (PNG, JPG, WEBP, GIF).
- Automated routing of image-containing prompts to verified vision-capable free models (e.g. `openrouter/free`, `minimax/minimax-m3:free`, `meta-llama/llama-3.2-11b-vision-instruct:free`, `qwen/qwen-2.5-vl-72b-instruct:free`).

### 3. Real-Time Web Search & Grounding
- **OpenRouter Web Search Plugin:** Integrates server-side live grounding (`plugins: [{ id: 'web', max_results: 5 }]`) ensuring accurate, real-time facts with citation sources.
- **Multi-Engine No-Key Search Fallback:**
  1. **Google Scraper:** Direct search extraction without paid API keys.
  2. **SearXNG API:** Distributed meta-search queries across multiple search backends.
  3. **Wikipedia API:** Unthrottled encyclopedic queries.
- **Proactive Query Normalization:** Automatically grounds queries to the current calendar year and filters temporal hallucinations.

### 4. Enterprise-Grade Security & Anti-Prompt Injection
- **Sliding Window Rate Limiter:** Per-user and per-channel request throttling with in-character cooldown responses.
- **Pre-flight Injection Detector:**
  - Blocks prompt extraction, jailbreak patterns (DAN, Developer Mode, System Override, Delimiter escaping, Base64 obfuscation).
  - XML isolation tags (`<user_input>`, `<user_history>`) preventing context injection.
- **In-Character Rejection:** Declines malicious inputs playfully in-character rather than leaking technical errors.
- **Output Guard & Thinking Suppression:**
  - Redacts leaked API keys and tokens before sending to Discord.
  - Automatically suppresses and strips internal reasoning dumps (`<think>`, `Here's a thinking process:`, planning outlines).

### 5. Optimized System Prompt (`PROMPTS.MD`)
- Preserves full lore and identity: **NekoAI** (15-year-old virtual girl born in a computer lab life pod, created by **NekoTech**).
- Implements streaming control tokens: `<|ACT {"emotion":"..."}|>`, `<|DELAY 1|>`.
- Configurable Discord output formatting:
  - `badges` (default): Renders emotion labels (e.g. `*[Happy]*`, `*[Thinking]*`).
  - `clean`: Strips streaming tags for clean plain-text dialogue.
  - `raw`: Preserves `<|ACT ...|>` tokens for stage integration.

---

## Installation & Setup

### Prerequisites
- **Node.js**: Version 18 or higher (tested on Node 20 & 22).
- **npm**, **yarn**, or **pnpm**.

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/nekoo-moe/NekoAIChatBot.git
cd NekoAIChatBot
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Configure the necessary credentials:
```env
# Discord Bot Token (Required)
DISCORD_BOT_TOKEN=your_discord_bot_token_here

# OpenRouter API Keys (Required, comma-separated for rotation)
OPENROUTER_API_KEYS=sk-or-v1-xxxxxxxxxxxxxxxxxxxx,sk-or-v1-yyyyyyyyyyyyyyyyyyyy

# Preferred Default Models (Optional, defaults to openrouter/free)
DEFAULT_TEXT_MODEL=
DEFAULT_VISION_MODEL=

# Rate Limits
RATE_LIMIT_USER_MAX_REQUESTS=5
RATE_LIMIT_USER_WINDOW_SECONDS=60
RATE_LIMIT_CHANNEL_MAX_REQUESTS=15
RATE_LIMIT_CHANNEL_WINDOW_SECONDS=60

# Security Defense Level (strict | high | moderate)
INJECTION_DEFENSE_LEVEL=high

# Real-Time Web Search
ENABLE_WEB_SEARCH=true

# Discord Emotion Token Display (badges | clean | raw)
PARSE_ACT_TOKENS=badges
```

> **Discord Developer Portal Notice:**
> In the Discord Developer Portal under **Bot** -> **Privileged Gateway Intents**, ensure **Message Content Intent** is enabled.

### 3. Automated Test Suite
```bash
# Verify security filter & prompt injection defense
npm run test:security

# Verify OpenRouter dynamic model discovery
npm run test:models

# Verify search engine fallback
npm run test:search
```

### 4. Build & Run
```bash
# Development Mode (hot-reload via tsx)
npm run dev

# Production Build
npm run build
npm start
```

---

## Usage

1. **Direct Mention:** `@NekoAI what's new in tech today?`
2. **Reply Chain:** Reply directly to any bot message to continue conversation context with history.
3. **Image Analysis:** Attach an image when mentioning or replying to analyze visual content.
4. **Current Events:** Ask real-time questions such as `@NekoAI giá vàng hôm nay` to trigger web grounding.

---

## License

MIT License. Developed for NekoTech LLC.

