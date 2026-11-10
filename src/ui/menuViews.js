const fs = require('fs');
const path = require('path');
const {
    getAutoDisconnectStatus
} = require('../audio/voiceSessionManager');
const {
    categoryNames
} = require('./uiBuilders');
const {
    getPlaybackMode,
    isBarkaEnabled
} = require('../config/settingsManager');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    EmbedBuilder,
    TextDisplayBuilder,
    StringSelectMenuBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SectionBuilder,
    MessageFlags,
    Message
} = require('discord.js');
const {
    getAudioEffectsConfig,
    AUDIO_EFFECTS
} = require('../extras/sound_effects');
// const { act } = require('react');

const EPHEMERAL_V2 = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
const text = (c) => new TextDisplayBuilder()
    .setContent(c);
const sep = (divider = true) =>
    new SeparatorBuilder()
        .setDivider(divider)
        .setSpacing(SeparatorSpacingSize.Small);

function option({ emoji, title, desc, id, style = ButtonStyle.Secondary, button = 'Wybierz' }) {
    return new SectionBuilder()
        .addTextDisplayComponents(text(`### ${emoji} ${title}\n-# ${desc}`))
        .setButtonAccessory(
            new ButtonBuilder()
                .setCustomId(id)
                .setLabel(button)
                .setStyle(style)
        );
}
function buildMenu({ title, subtitle, color = 0x5865F2, options = [], extra = [], back = null }) {
    const c = new ContainerBuilder()
        .setAccentColor(color);
    c.addTextDisplayComponents(text(`# ${title}${subtitle ? `\n${subtitle}` : ''}`));
    c.addSeparatorComponents(sep());
    options.forEach(o => c.addSectionComponents(option(o)));
    extra.forEach(fn => fn(c));
    if (back) {
        c.addSeparatorComponents(sep(false));
        c.addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(back)
                    .setLabel('⬅️ Powrót')
                    .setStyle(ButtonStyle.Secondary)
            )
        );
    }
    return { components: [c], flags: MessageFlags.IsComponentsV2 };
}

const views = {
    manage: () => buildMenu({
        title: '📁 Zarządzanie',
        subtitle: 'Co chcesz zrobić?',
        color: 0x5865F2,
        options: [
            { emoji: '🗂️', title: 'Kategorie', desc: 'Dodawaj, zmieniaj nazwy i usuwaj kategorie', id: 'nav:categories', style: ButtonStyle.Primary },
            { emoji: '🎵', title: 'Dźwięki', desc: 'Dodawaj, zmieniaj nazwy i usuwaj dźwięki', id: 'nav:sounds', style: ButtonStyle.Success },
        ],
    }),
    categories: () => buildMenu({
        title: '🗂️ Kategorie',
        subtitle: 'Wybierz operację:',
        options: [
            { emoji: '➕', title: 'Nowa kategoria', desc: 'Tworzy nowy folder i panel kategorii', id: 'cat_action_add', style: ButtonStyle.Success, button: 'Utwórz' },
            { emoji: '✏️', title: 'Zmień nazwę', desc: 'Zmienia nazwę wyświetlaną kategorii', id: 'cat_action_rename', style: ButtonStyle.Primary, button: 'Zmień' },
            { emoji: '🗑️', title: 'Usuń kategorię', desc: 'Usuwa z panelu lub razem z plikami', id: 'cat_action_delete', style: ButtonStyle.Danger, button: 'Usuń' },
        ],
        back: 'nav:manage',
    }),
    sounds: () => buildMenu({
        title: '🎵 Dźwięki',
        subtitle: 'Wybierz operację:',
        options: [
            { emoji: '➕', title: 'Dodaj dźwięk', desc: 'Z linku YouTube / SoundCloud lub z pliku', id: 'nav:addsound', style: ButtonStyle.Success, button: 'Dodaj' },
            { emoji: '✏️', title: 'Zmień nazwę', desc: 'Zmienia nazwę wyświetlaną na przycisku', id: 'sound_action_rename', style: ButtonStyle.Primary, button: 'Zmień' },
            { emoji: '🗑️', title: 'Usuń dźwięk', desc: 'Trwale usuwa plik z dysku', id: 'sound_action_delete', style: ButtonStyle.Danger, button: 'Usuń' },
        ],
        back: 'nav:manage',
    }),
    addsound: () => buildMenu({
        title: '➕ Dodaj dźwięk',
        subtitle: 'Wybierz źródło:',
        options: [
            { emoji: '🔗', title: 'Link', desc: 'YouTube / SoundCloud, z opcjonalnym przycięciem', id: 'sound_add_choice_url', style: ButtonStyle.Primary, button: 'Wklej link' },
            { emoji: '📁', title: 'Plik audio', desc: 'Użyj komendy `/sound add` i załącz plik .mp3 / .wav', id: 'sound_add_choice_file', style: ButtonStyle.Secondary, button: 'Jak to zrobić?' },
        ],
        back: 'nav:sounds',
    }),
    settings: (interaction) => {
        const status = getAutoDisconnectStatus(interaction.guildId);
        const presets = [5, 10, 30, 60];
        const currentMode = getPlaybackMode();
        return buildMenu({
            title: '⚙️ Ustawienia',
            color: 0x99AAB5,
            extra: [(c) => {
                // --- SECTION 1: AUTODISCONNECT OPTIONS ---
                c.addTextDisplayComponents(text(status.message));
                c.addActionRowComponents(
                    new ActionRowBuilder().addComponents(
                        ...presets.map(m =>
                            new ButtonBuilder()
                                .setCustomId(`set_disc:${m}`)
                                .setLabel(`${m} min`)
                                .setStyle(status.enabled && status.minutes === m ? ButtonStyle.Success : ButtonStyle.Secondary)
                        ),
                        new ButtonBuilder()
                            .setCustomId('set_disc:0')
                            .setLabel('Wyłącz')
                            .setStyle(!status.enabled ? ButtonStyle.Danger : ButtonStyle.Secondary)
                    )
                );
                c.addSeparatorComponents(sep());
                // --- SECTION 2: PLAY MODE (MIX or QUEUE) ---
                c.addSectionComponents(option({
                    emoji: currentMode === 'queue' ? '📜' : '🎛️',
                    title: 'Tryb odtwarzania dźwięków',
                    desc: currentMode === 'queue'
                        ? 'Queue Mode - Dźwięki są odtwarzane jeden po drugim.'
                        : 'Mix Mode - Wszystkie dźwięki naraz.',
                    id: `set_mode:${currentMode === 'mix' ? 'queue' : 'mix'}`,
                    style: currentMode === 'queue' ? ButtonStyle.Primary : ButtonStyle.Success,
                    button: currentMode === 'queue' ? 'Przełącz na Mix' : 'Przełącz na Queue'
                }));
                c.addSeparatorComponents(sep());
                // --- SECTION 3: LIBRARY REFRESH ---
                c.addSectionComponents(option({
                    emoji: '🔄', title: 'Odśwież bibliotekę',
                    desc: 'Wysyła cały soundboard na kanał od nowa',
                    id: 'sys_rebuild_all', style: ButtonStyle.Success, button: 'Odśwież',
                }));
            }],
        });
    },

    addons: () => {
        const barkaActive = typeof isBarkaEnabled === 'function' ? isBarkaEnabled() : false;
        const fxConfig = typeof getAudioEffectsConfig === 'function' ? getAudioEffectsConfig() : {};
        const EFFECTS = {
            bassboost: { icon: '🔊', name: 'Bass Boost', desc: 'Mocniejszy bas' },
            nightcore: { icon: '⚡', name: 'Nightcore', desc: 'Czas na Touhou!' },
            vaporwave: { icon: '🌊', name: 'Vaporwave', desc: 'Wolniej i niżej - retro!' },
            speedup: { icon: '⏩', name: 'Speed Up', desc: `I'm speed!` },
            slowed: { icon: '🐌', name: 'Slowed', desc: 'Ja lubię wolmo' },
            reverb: { icon: '🏰', name: 'Reverb', desc: 'Głosy wszędzie słyszę' },
            radio: { icon: '📻', name: 'Radio', desc: 'Kogo mamy dzisiaj na antenie?' },
            '8d': { icon: '🎧', name: '8D Audio', desc: 'Kiełbie we łbie' },
            earrape: { icon: '⚠️', name: 'Earrape', desc: 'Za cicho gra ten bot' },
            earrape2: { icon: '⚠️', name: 'Earrape 2', desc: 'Za cicho gra ten bot, ale to wersja 2' },
            telephone: { icon: '📞', name: 'Telephone', desc: 'POV: Dzwonię na Roxę' },
            underwater: { icon: '🌊', name: 'Underwater', desc: `I'm under the water pls help me` },
            demon: { icon: '😈', name: 'Demon', desc: 'Pora umierać śmiertelniku' }
        };
        const keys = Object.keys(AUDIO_EFFECTS).slice(0, 25);
        const info = (k) => EFFECTS[k] || { icon: '🎵', name: k, desc: 'Efekt audio' };
        const active = keys.filter(k => fxConfig[k]);
        const bar = '▰'.repeat(Math.min(active.length, 13)) + '▱'.repeat(Math.max(0, Math.min(keys.length, 13) - active.length));
        const activeText = active.length
            ? active.map(k => `${info(k).icon} ${info(k).name}`).join('  •  ')
            : '*Brak aktywnych efektów*';
        const select = new StringSelectMenuBuilder()
            .setCustomId('fx_select')
            .setPlaceholder('Wybierz efekty do włączenia...')
            .setMinValues(0)
            .setMaxValues(keys.length)
            .addOptions(keys.map(k => ({
                label: info(k).name,
                value: k,
                description: info(k).desc.slice(0, 100),
                emoji: { name: info(k).icon },
                default: !!fxConfig[k],
            })));
        return buildMenu({
            title: '💥 Dodatki',
            subtitle: 'Dostępne rozszerzenia:',
            color: active.length > 0 ? 0x9B59B6 : 0x99AAB5,
            extra: [(c) => {
                c.addSectionComponents(
                    option({
                        emoji: barkaActive ? '🔔' : '🔕',
                        title: 'Barka o 21:37',
                        desc: barkaActive
                            ? 'Włączona - bot automatycznie wbije na kanał o 21:37'
                            : 'Wyłączona - bot nie wbije o 21:37',
                        id: 'addon_toggle_barka',
                        style: barkaActive ? ButtonStyle.Secondary : ButtonStyle.Success,
                        button: barkaActive ? 'Wyłącz' : 'Włącz'
                    })
                );
                c.addSeparatorComponents(sep());
                c.addTextDisplayComponents(
                    text(`### 🎚️ Efekty audio\n${bar}  **${active.length}/${keys.length}** aktywnych\n-# Działają od następnego dźwięku`)
                );
                c.addActionRowComponents(new ActionRowBuilder().addComponents(select));
                if (active.length > 0) {
                    c.addActionRowComponents(
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId('fx_reset')
                                .setLabel('Wyłącz wszystkie')
                                .setStyle(ButtonStyle.Danger)
                        )
                    );
                }
            }],
        });
    },

    commands: () => buildMenu({
        title: '📜 Komendy',
        color: 0x57F287,
        extra: [(c) => c.addTextDisplayComponents(text(
            '**Odtwarzanie**\n' +
            '`/play` - odtwarza muzykę z YouTube/Spotify\n' +
            '`/stopall` - zatrzymuje wszystkie dźwięki\n\n' +
            '**Panel**\n' +
            '`/setup-panel` - generuje cały soundboard na kanale\n' +
            '`/panel` - prywatny panel sterowania\n' +
            '`/disconnect` - auto-rozłączanie po bezczynności\n\n' +
            '**Ulubione**\n' +
            '`/favorite` - lista ulubionych dźwięków\n' +
            '`list` · `add` · `remove`\n\n' +
            '**Dźwięki** (`/sound ...`)\n' +
            '`add` · `delete` · `rename` · `move` · `emoji` · `normalize`\n\n' +
            '**Kategorie** (`/category ...`)\n' +
            '`create` · `rename` · `hide` · `delete` · `color` · `build`'
        ))],
    }),
};

module.exports = { views, EPHEMERAL_V2 };