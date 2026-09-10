import {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  Interaction,
  GuildMember,
  PermissionsBitField,
  TextChannel,
  DMChannel,
} from 'discord.js';
import { LLMRouter, ProviderType } from '../../llm/llmRouter.js';
import { OpenAIClient } from '../../openai/client.js';
import { GeminiClient } from '../../gemini/client.js';
import { ModelManager } from '../../openrouter/modelManager.js';
import { config } from '../../config.js';

export class ProviderConsole {
  private static instance: ProviderConsole;

  private constructor() {}

  public static getInstance(): ProviderConsole {
    if (!ProviderConsole.instance) {
      ProviderConsole.instance = new ProviderConsole();
    }
    return ProviderConsole.instance;
  }

  /**
   * Checks if user has admin authority to open or manipulate the console
   */
  public isAuthorized(userId: string, member?: GuildMember | null): boolean {
    // 1. Explicit ADMIN_DISCORD_IDS whitelist
    if (config.adminDiscordIds.length > 0) {
      return config.adminDiscordIds.includes(userId);
    }

    // 2. Server owner or Guild Administrator fallback
    if (member) {
      if (member.guild.ownerId === userId) return true;
      if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
    }

    // 3. If no admin IDs are configured and in DM, allow first user with a hint
    if (!member) {
      return true;
    }

    return false;
  }

  /**
   * Generates the Discord UI Message (Embed + Select Menus + Buttons)
   */
  public buildConsoleMessage(testResult?: string) {
    const router = LLMRouter.getInstance();
    const status = router.getProviderStatus();

    const providerLabels: Record<ProviderType, string> = {
      auto: '⚡ Tự động (Auto Mode)',
      openai: '🟢 OpenAI-Compatible',
      gemini: '🔵 Google Gemini API',
      openrouter: '🟣 OpenRouter Free',
    };

    // 1. Build Embed
    const embed = new EmbedBuilder()
      .setTitle('🎮 NekoAI — Bảng Điều Khiển Quản Trị Provider & Model')
      .setDescription(
        `Bảng điều khiển trực tiếp cấu hình AI cho bot. Các thay đổi có hiệu lực ngay lập tức (*hot-swapped*) cho các cuộc trò chuyện tiếp theo nya~`
      )
      .setColor(0xff70a6)
      .addFields(
        {
          name: '🎯 Provider Đang Chọn',
          value: `**${providerLabels[status.activeProvider]}**`,
          inline: true,
        },
        {
          name: '🧠 Model Hiện Tại',
          value: `\`${status.activeModel}\``,
          inline: true,
        },
        {
          name: '🌐 Web Search Tool',
          value: status.webSearchEnabled ? '✅ **Đang BẬT**' : '❌ **Đang TẮT**',
          inline: true,
        },
        {
          name: '🔑 Trạng Thái Các Provider Kết Nối',
          value: [
            `• **OpenAI-Compatible**: ${
              status.openai.configured
                ? `🟢 Sẵn sàng (${status.openai.keysCount} key)`
                : '⚪ Chưa có key'
            } | Model: \`${status.openai.model}\` | Endpoint: \`${status.openai.baseUrl}\``,
            `• **Google Gemini**: ${
              status.gemini.configured
                ? `🟢 Sẵn sàng (${status.gemini.keysCount} key)`
                : '⚪ Chưa có key'
            } | Model: \`${status.gemini.model}\``,
            `• **OpenRouter**: ${
              status.openrouter.configured
                ? `🟢 Sẵn sàng (${status.openrouter.keysCount} key, ${status.openrouter.modelsCount} free models)`
                : '⚪ Chưa có key'
            } | Model: \`${status.openrouter.model}\``,
          ].join('\n'),
        }
      );

    if (testResult) {
      embed.addFields({
        name: '🧪 Kết Quả Kiểm Tra Kết Nối',
        value: testResult,
      });
    }

    embed.setFooter({
      text: '💡 Mẹo: Dùng menu chọn bên dưới để đổi Provider hoặc Model nhanh chóng.',
    });
    embed.setTimestamp();

    // 2. Row 1: Select Provider Menu
    const providerSelect = new StringSelectMenuBuilder()
      .setCustomId('neko_select_provider')
      .setPlaceholder('Chọn Provider hoạt động...')
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel('⚡ Tự động (Auto Mode)')
          .setDescription('Ưu tiên OpenAI -> Gemini -> OpenRouter')
          .setValue('auto')
          .setDefault(status.activeProvider === 'auto'),
        new StringSelectMenuOptionBuilder()
          .setLabel('🟢 OpenAI-Compatible')
          .setDescription('GPT-4o, DeepSeek, Groq, Ollama, LM Studio...')
          .setValue('openai')
          .setDefault(status.activeProvider === 'openai'),
        new StringSelectMenuOptionBuilder()
          .setLabel('🔵 Google Gemini API')
          .setDescription('Gemini 3.6 Flash, 2.5 Flash, Gemma 4...')
          .setValue('gemini')
          .setDefault(status.activeProvider === 'gemini'),
        new StringSelectMenuOptionBuilder()
          .setLabel('🟣 OpenRouter Free')
          .setDescription('Danh sách Free Models xoay tua chất lượng cao')
          .setValue('openrouter')
          .setDefault(status.activeProvider === 'openrouter')
      );

    const providerRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(providerSelect);

    // 3. Row 2: Select Model Menu
    const rawModels = router.getAvailableModels(status.activeProvider);
    const uniqueModels = Array.from(new Set(rawModels)).filter(Boolean);
    const candidateModels = uniqueModels.length > 0 ? uniqueModels.slice(0, 25) : ['default'];

    const modelSelect = new StringSelectMenuBuilder()
      .setCustomId('neko_select_model')
      .setPlaceholder(`Chọn Model cho [${status.activeProvider.toUpperCase()}]...`);

    const modelOptions = candidateModels.map((m) => {
      const isSelected = m === status.activeModel;
      const cleanLabel = m.length > 100 ? m.substring(0, 97) + '...' : m;
      return new StringSelectMenuOptionBuilder()
        .setLabel(cleanLabel)
        .setValue(m)
        .setDefault(isSelected);
    });

    modelSelect.addOptions(modelOptions);
    const modelRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(modelSelect);

    // 4. Row 3: Action Buttons
    const btnTest = new ButtonBuilder()
      .setCustomId('neko_btn_test')
      .setLabel('🧪 Test Nhanh LLM')
      .setStyle(ButtonStyle.Primary);

    const btnSearch = new ButtonBuilder()
      .setCustomId('neko_btn_toggle_search')
      .setLabel(status.webSearchEnabled ? '🌐 Web Search: BẬT' : '🌐 Web Search: TẮT')
      .setStyle(status.webSearchEnabled ? ButtonStyle.Success : ButtonStyle.Secondary);

    const btnRefresh = new ButtonBuilder()
      .setCustomId('neko_btn_refresh')
      .setLabel('🔄 Làm Mới Models')
      .setStyle(ButtonStyle.Secondary);

    const btnClose = new ButtonBuilder()
      .setCustomId('neko_btn_close')
      .setLabel('❌ Đóng Console')
      .setStyle(ButtonStyle.Danger);

    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      btnTest,
      btnSearch,
      btnRefresh,
      btnClose
    );

    return {
      embeds: [embed],
      components: [providerRow, modelRow, buttonRow],
    };
  }

  /**
   * Handles incoming component interactions from the Console UI
   */
  public async handleInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isStringSelectMenu() && !interaction.isButton()) {
      return;
    }

    const customId = interaction.customId;
    if (!customId.startsWith('neko_')) {
      return;
    }

    // Check authority
    const isAuth = this.isAuthorized(interaction.user.id, interaction.member as any);
    if (!isAuth) {
      await interaction.reply({
        content: `<|ACT {"emotion":"awkward"}|> W-waah! Bảng điều khiển này là khu vực quản trị viên riêng tư nya~! Bạn không có quyền điều chỉnh đâu nè! <|ACT {"emotion":"angry"}|>`,
        ephemeral: true,
      });
      return;
    }

    const router = LLMRouter.getInstance();

    // 1. Select Provider
    if (customId === 'neko_select_provider' && interaction.isStringSelectMenu()) {
      const selectedProvider = interaction.values[0] as ProviderType;
      router.setActiveProvider(selectedProvider);
      await interaction.update(this.buildConsoleMessage());
      return;
    }

    // 2. Select Model
    if (customId === 'neko_select_model' && interaction.isStringSelectMenu()) {
      const selectedModel = interaction.values[0];
      router.setActiveModel(selectedModel);
      await interaction.update(this.buildConsoleMessage());
      return;
    }

    // 3. Test LLM Connection
    if (customId === 'neko_btn_test' && interaction.isButton()) {
      await interaction.deferUpdate();
      const startTime = Date.now();
      try {
        const testRes = await router.generateChatCompletion({
          messages: [
            {
              role: 'user',
              content: 'Chào NekoAI! Hãy trả lời ngắn 1 câu thật dễ thương kèm tiếng nya~ nhé!',
            },
          ],
          maxTokens: 150,
          temperature: 0.7,
        });
        const elapsed = Date.now() - startTime;
        const msg = `✅ **Kiểm tra thành công** trong **${elapsed}ms**!\n**Provider**: \`${testRes.provider.toUpperCase()}\` | **Model**: \`${testRes.usedModel}\`\n💬 **Phản hồi**: "${testRes.content.replace(/\r?\n/g, ' ')}"`;
        await interaction.editReply(this.buildConsoleMessage(msg));
      } catch (err: any) {
        const elapsed = Date.now() - startTime;
        const errorMsg = `❌ **Kiểm tra thất bại** sau **${elapsed}ms**!\n**Lỗi**: \`${err.message || 'Không rõ nguyên nhân'}\``;
        await interaction.editReply(this.buildConsoleMessage(errorMsg));
      }
      return;
    }

    // 4. Toggle Web Search
    if (customId === 'neko_btn_toggle_search' && interaction.isButton()) {
      router.toggleWebSearch();
      await interaction.update(this.buildConsoleMessage());
      return;
    }

    // 5. Refresh Models
    if (customId === 'neko_btn_refresh' && interaction.isButton()) {
      await interaction.deferUpdate();
      try {
        await Promise.allSettled([
          OpenAIClient.getInstance().refreshModels(),
          GeminiClient.getInstance().refreshModels(),
          ModelManager.getInstance().initialize(),
        ]);
        await interaction.editReply(
          this.buildConsoleMessage('🔄 **Đã quét và làm mới danh sách model từ các provider thành công!**')
        );
      } catch (err: any) {
        await interaction.editReply(
          this.buildConsoleMessage(`⚠️ Quét model có cảnh báo: ${err.message}`)
        );
      }
      return;
    }

    // 6. Close Console
    if (customId === 'neko_btn_close' && interaction.isButton()) {
      await interaction.update({
        content: '🔒 **Bảng điều khiển quản trị Provider đã được đóng.**\n*Gõ `!provider` hoặc `!console` khi bạn muốn mở lại nya~*',
        embeds: [],
        components: [],
      });
      return;
    }
  }
}
