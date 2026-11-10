// ** Responsible for creating a Main Panel and calculate progress bar ** //
const path = require('path');
const {
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SectionBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    MessageFlags,
    ThumbnailBuilder,
    // AutoModerationRuleKeywordPresetType
} = require('discord.js');
const {
    getActiveTracks,
    guildSessions
} = require('../audio/voiceSessionManager');
const {
    categoryNames,
    soundDisplayNames
} = require('./configManager');
const {
    audioQueue
} = require('../audio/playerService');
const {
    getPlaybackMode
} = require('../config/settingsManager');

function formatTime(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function buildProgressBar(elapsed, total, length = 12) {
    if (!total || total <= 0) return `▱`.repeat(length) + ` ${formatTime(elapsed)}`;
    const ratio = Math.min(1, Math.max(0, elapsed / total));
    const filled = Math.round(ratio * length);
    const empty = Math.max(0, length - filled);
    return `${'▰'.repeat(filled)}${'▱'.repeat(empty)} ${formatTime(elapsed)} / ${formatTime(total)}`;
}

function buildMainDashboard(member = null, isOffline = false, mainPanelMessageRef = null) {
    const guildId = member?.guild?.id || mainPanelMessageRef?.guildId || null;
    const tracksMap = typeof getActiveTracks === 'function' ? getActiveTracks(guildId) : new Map();
    const activeCount = tracksMap?.size || 0;
    const queueCount = audioQueue ? audioQueue.length : 0;
    const currentMode = getPlaybackMode();
    const now = Date.now();
    const FIXED = 12;
    const MAX_FULL = Math.floor((40 - FIXED) / 3);
    const DEFAULT_AVATAR = 'https://cdn.discordapp.com/embed/avatars/0.png';
    const avatarOf = (t) => t?.avatarUrl || DEFAULT_AVATAR;
    const session = guildId ? guildSessions.get(guildId) : null;
    const isConnected = !!(session && session.connection && session.connection.state.status !== 'destroyed');
    let accentColor = 0xED4245;
    let statusHeader = '# 📟 Panel\n🔴 **Status:** Disconnected';
    if (isOffline) {
        accentColor = 0x2F3136;
        statusHeader = '# 📟 Panel\n🔴 **Status:** Offline';
    } else if (activeCount > 0) {
        accentColor = 0x57F287;
        statusHeader = `# 📟 Panel\n🟢 **Aktywne dźwięki:** ${activeCount}` + (currentMode === 'queue' && queueCount > 0 ? ` | 📑 **Kolejka:** ${queueCount}` : '');
    } else if (isConnected) {
        accentColor = 0x3498DB;
        statusHeader = '# 📟 Panel\n🔵 **Status:** Idle (Ready)';
    }
    const container = new ContainerBuilder()
        .setAccentColor(accentColor);
    const modeLabel = currentMode === 'mix' ? '🎶 Mix' : '⏳ Queue';
    const targetMode = currentMode === 'mix' ? 'queue' : 'mix';
    const headerSection = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(statusHeader)
        )
        .setButtonAccessory(
            new ButtonBuilder()
                .setCustomId(`toggle_mode:${targetMode}`)
                .setLabel(modeLabel)
                .setStyle(currentMode === 'mix' ? ButtonStyle.Success : ButtonStyle.Primary)
        );
    container.addSectionComponents(headerSection);
    container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );
    if (isOffline) {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent('-# Usługa bota została zatrzymana.')
        );
        return { components: [container], flags: MessageFlags.IsComponentsV2 };
    }
    const getInfo = (track) => {
        const soundKey = `${track.category}/${track.file}`;
        const name = (typeof soundDisplayNames !== 'undefined' && soundDisplayNames[soundKey])
            ? soundDisplayNames[soundKey]
            : path.parse(track.file).name;
        const cat = categoryNames[track.category] || track.category;
        const elapsed = track.startedAt ? now - track.startedAt : 0;
        return { name, cat, bar: buildProgressBar(elapsed, track.duration) };
    };
    // --- 1. ACTIVE SOUNDS ---
    if (activeCount > 0) {
        const entries = [...tracksMap.entries()];
        if (activeCount <= MAX_FULL) {
            entries.forEach(([id, track], i) => {
                const { name, cat, bar } = getInfo(track);
                const who = track.userId ? `<@${track.userId}>` : (track.userTag || '?');
                container.addSectionComponents(
                    new SectionBuilder()
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(
                                `**${name}**\n${bar}\n-# ${cat} | Włączył: ${who}`
                            )
                        )
                        .setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarOf(track)))
                );
                container.addActionRowComponents(
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`stop_track:${id}`)
                            .setLabel('🛑 Wyłącz')
                            .setStyle(ButtonStyle.Danger)
                    )
                );
            });
        } else {
            const lines = entries.map(([id, track], i) => {
                const { name, bar } = getInfo(track);
                return `**${i + 1}.** ${name.slice(0, 25)}\n${bar}`;
            });
            let text = lines.join('\n');
            if (text.length > 3900) text = text.slice(0, 3900) + '\n…';
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
            let budget = 40 - FIXED - 1;
            let cursor = 0;
            while (budget >= 2 && cursor < entries.length) {
                const n = Math.min(5, budget - 1, entries.length - cursor);
                const row = new ActionRowBuilder();
                for (let k = 0; k < n; k++) {
                    const [id] = entries[cursor + k];
                    row.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`stop_track:${id}`)
                            .setLabel(`🛑 ${cursor + k + 1}`)
                            .setStyle(ButtonStyle.Danger)
                    );
                }
                container.addActionRowComponents(row);
                budget -= n + 1;
                cursor += n;
            }
            if (cursor < entries.length) {
                if (budget >= 1) {
                    container.addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `-# Brak przycisków dla ${entries.length - cursor} dźwięków – użyj „Stop wszystko”`
                        )
                    );
                }
            }
        }
        container.addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('ctrl_stop_all')
                    .setLabel('🛑 Stop wszystko')
                    .setStyle(ButtonStyle.Danger)
            )
        );
        container.addSeparatorComponents(
            new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
        );
    }
    // --- 2. QUEUED TRACKS ---
    if (currentMode === 'queue' && queueCount > 0) {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`### 📑 Kolejka Odtwarzania - Długość: ${queueCount} utworów`)
        );
        audioQueue.slice(0, 5).forEach((qTrack, idx) => {
            const soundKey = `${qTrack.category}/${qTrack.file}`;
            const name = (typeof soundDisplayNames !== 'undefined' && soundDisplayNames[soundKey])
                ? soundDisplayNames[soundKey]
                : path.parse(qTrack.file).name;
            const cat = categoryNames[qTrack.category] || qTrack.category;
            const who = qTrack.userId ? `<@{qTrack.userId}>` : (qTrack.userTag || '?');
            container.addSectionComponents(
                new SectionBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `**${name}**\n-# ${cat} | Dodał: ${who}`
                        )
                    )
                    .setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarOf(qTrack)))
            );
            container.addActionRowComponents(
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`remove_queue:${idx}`)
                        .setLabel('🗑️ Usuń')
                        .setStyle(ButtonStyle.Secondary)
                )
            );
        });
        if (queueCount > 5) {
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`-# i ${queueCount - 5} więcej w kolejce...`)
            );
        }
        container.addSeparatorComponents(
            new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
        );
    }
    // --- 3. SYSTEM BUTTONS ---
    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('sys_manage').setLabel('📁 Zarządzanie').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('sys_settings').setLabel('🛠️ Ustawienia').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('sys_addons').setLabel('💥 Dodatki').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('sys_commands').setLabel('🤖 Wyświetl komendy').setStyle(ButtonStyle.Success)
        )
    );
    return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

module.exports = {
    buildMainDashboard,
    buildProgressBar,
    formatTime
};