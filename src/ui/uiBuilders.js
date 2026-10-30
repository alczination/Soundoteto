// Build Dashboards, Categories, Embeds and Refresh Messages on channel
const fs = require('fs');
const path = require('path');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    PermissionsBitField,
    ActionRow
} = require('discord.js');
const { SOUNDS_DIR, getActiveTracks } = require('../audio/audioManager');
const CONFIG_PATH = path.join(__dirname, '../../config/categories.json');

async function syncLocalIconsToGuild(guild) {
    if (!guild) return;
    const baseIconDir = path.join(__dirname, '../../ico');
    if (!fs.existsSync(baseIconDir)) return;
    if (!fs.existsSync(SOUNDS_DIR)) return;

    const categories = fs.readdirSync(SOUNDS_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory() && d.name !== 'ico' && !hiddenCategories.has(d.name))
        .map(d => d.name);

    const catIconDir = path.join(baseIconDir, 'categories');
    if (fs.existsSync(catIconDir)) {
        const catFiles = fs.readdirSync(catIconDir, { withFileTypes: true })
            .filter(item => item.isFile() && /\.(png|jpg|jpeg|ico|gif)$/i.test(item.name))
            .map(item => item.name);
        for (const catFile of catFiles) {
            const catName = path.parse(catFile).name;
            if (categories.includes(catName) && !categoryEmojis[catName]) {
                const icoPath = path.join(catIconDir, catFile);
                try {
                    const safeEmojiName = `cat_ico_${catName}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 32);
                    let existingEmoji = guild.emojis.cache.find(e => e.name === safeEmojiName);
                    if (!existingEmoji) {
                        console.log(`[Auto-Icon] Wgrywanie ikony kategorii z ico/categories/: ${catFile}`);
                        existingEmoji = await guild.emojis.create({
                            attachment: icoPath,
                            name: safeEmojiName
                        });
                    }
                    categoryEmojis[catName] = `<:${existingEmoji.name}:${existingEmoji.id}>`;
                    saveConfig();
                    console.log(`[Auto-Ico] Przypisano ikonę do kategorii ${catName}`);
                } catch (err) {
                    console.error(`[Auto-Ico] Błąd wgrywania ikony kategorii ${catName}`);
                }
            }
        }
    }
    const buttonFiles = fs.readdirSync(baseIconDir, { withFileTypes: true })
        .filter(item => item.isFile() && /\.(png|jpg|jpeg|ico|gif)$/i.test(item.name))
        .map(item => item.name);
    for (const icoFile of buttonFiles) {
        const baseName = path.parse(icoFile).name;
        for (const cat of categories) {
            const mp3File = `${baseName}.mp3`;
            const wavFile = `${baseName}.wav`;
            const catPath = path.join(SOUNDS_DIR, cat);
            const targetAudio = fs.existsSync(path.join(catPath, mp3File)) ? mp3File
                : (fs.existsSync(path.join(catPath, wavFile)) ? wavFile : null);
            if (targetAudio) {
                const buttonKey = `${cat}/${targetAudio}`;
                if (buttonEmojis[buttonKey]) break;
                const icoPath = path.join(baseIconDir, icoFile);
                try {
                    const safeEmojiName = `ico_${cat}_${baseName}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 32);
                    let existingEmoji = guild.emojis.cache.find(e => e.name === safeEmojiName);
                    if (!existingEmoji) {
                        console.log(`[Auto-Ico] Wgrywanie nowej ikony z folderu ikon: ${icoFile}`);
                        existingEmoji = await guild.emojis.create({
                            attachment: icoPath,
                            name: safeEmojiName
                        });
                    }
                    buttonEmojis[buttonKey] = `<:${existingEmoji.name}:${existingEmoji.id}>`;
                    saveConfig();
                    console.log(`[Auto-Ico] Przypisano ikonę ${icoFile} do przycisku ${buttonKey}`);
                } catch (err) {
                    console.error(`[Auto-Ico] Błąd podczas wgrywania ${icoFile}:`, err.message);
                }
                break;
            }
        }
    }
}

function loadConfig() {

    if (fs.existsSync(CONFIG_PATH)) {
        try {
            const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
            const parsed = JSON.parse(data);
            return {
                names: parsed.names || {},
                soundNames: parsed.soundNames || {},
                colors: parsed.colors || {},
                normalizedFiles: new Set(parsed.normalizedFiles || []),
                categoryEmojis: parsed.categoryEmojis || {},
                buttonEmojis: parsed.buttonEmojis || {},
                hidden: new Set(parsed.hidden || [])
            };
        } catch (err) {
            console.error('Błąd podczas odczytu config/categories.json:', err);
        }
    }
    return { names: {}, soundNames: {}, colors: {}, normalizedFiles: new Set(), categoryEmojis: {}, buttonEmojis: {}, hidden: new Set() };
}

const config = loadConfig();
const categoryNames = config.names;
const soundDisplayNames = config.soundNames;
const categoryColors = config.colors;
const normalizedFiles = config.normalizedFiles;
const categoryEmojis = config.categoryEmojis;
const buttonEmojis = config.buttonEmojis;
const hiddenCategories = config.hidden;

function saveConfig() {
    try {
        const payload = {
            names: categoryNames,
            soundNames: soundDisplayNames,
            normalizedFiles: Array.from(normalizedFiles),
            colors: categoryColors,
            categoryEmojis: categoryEmojis,
            buttonEmojis: buttonEmojis,
            hidden: Array.from(hiddenCategories),
            mainPanelRef: mainPanelMessageRef ? {
                channelId: mainPanelMessageRef.channel.id,
                messageId: mainPanelMessageRef.id
            } : null
        };
        const configDir = path.dirname(CONFIG_PATH);
        if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(payload, null, 2), 'utf8');
    } catch (err) {
        console.error('Błąd podczas zapisu config/categories.json', err);
    }
}

const categoryMessageRefs = new Map();
let mainPanelMessageRef = null;

function buildMainDashboard(member = null) {
    const guildId = member?.guild?.id || null;
    const tracksMap = getActiveTracks(guildId);
    const activeCount = tracksMap?.size || 0;
    const isOwner = member && member.guild ? member.guild.ownerId === member.id : false;
    const hasAdminPerm = member && member.permissions && typeof member.permissions.has === 'function'
        ? member.permissions.has(PermissionsBitField.Flags.Administrator)
        : false;
    const isAdmin = member === null ? true : (isOwner || hasAdminPerm);
    const embed = new EmbedBuilder()
        .setTitle('Główny panel')
        .setColor(activeCount > 0 ? 0x57F287 : 0xED4245)
        .setTimestamp();
    const components = [];
    if (activeCount > 0) {
        let description = `🟢 **Aktywne dźwięki (${activeCount}):**\n\n`;
        const trackStopButtons = [];
        let index = 1;
        for (const [id, track] of tracksMap.entries()) {
            description += `**${index}. ${track.file}** *(Kategoria: ${track.category})*\n└ Włączony przez: **${track.userTag}**\n\n`;
            if (isAdmin && trackStopButtons.length < 5) {
                trackStopButtons.push(
                    new ButtonBuilder()
                        .setCustomId(`stop_track:${id}`)
                        .setLabel(`🛑 Wyłącz: ${track.file.slice(0, 15)}`)
                        .setStyle(ButtonStyle.Danger)
                );
            }
            index++;
        }
        embed.setDescription(description);
        if (isAdmin && trackStopButtons.length > 0) {
            components.push(new ActionRowBuilder().addComponents(trackStopButtons));
        }
        if (isAdmin) {
            const systemRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('ctrl_stop_all')
                    .setLabel('🛑 Stop wszystko')
                    .setStyle(ButtonStyle.Danger)
            );
            components.push(systemRow);
        }
    } else {
        embed.setDescription('🔴 **Status:** Idle');
    }
        if (isAdmin) {
            const systemRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('sys_manage')
                    .setLabel('Zarządzanie')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('sys_rebuild_all')
                    .setLabel('🔄 Odśwież bibliotekę')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('sys_settings')
                    .setLabel('⚙️ Ustawienia')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('sys_addons')
                    .setLabel('🧩 Dodatki')
                    .setStyle(ButtonStyle.Secondary)
            );
            components.push(systemRow);
        }
    return { embeds: [embed], components };
}

function buildCategoryMessage(categoryName) {
    const catPath = path.join(SOUNDS_DIR, categoryName);
    const files = fs.readdirSync(catPath)
        ? fs.readdirSync(catPath, { withFileTypes: true })
            .filter(item => item.isFile() && (item.name.endsWith('.mp3') || item.name.endsWith('.wav')))
            .map(item => item.name) : [];
    const displayName = categoryNames[categoryName] || categoryName.replace(/_/g, ' ').toUpperCase();
    const buttonStyle = categoryColors[categoryName] || ButtonStyle.Primary;
    const catEmoji = categoryEmojis[categoryName] || null;
    const embedTitle = catEmoji ? `${catEmoji} ${displayName}` : `${displayName}`;
    const embed = new EmbedBuilder()
        .setTitle(embedTitle)
        .setColor(0x3498DB);
    if (files.length === 0) return { embeds: [embed], components: [] }
    const rows = [];
    let currentRow = new ActionRowBuilder();
    files.slice(0, 25).forEach((file, index) => {
        const soundKey = `${categoryName}/${file}`;
        const labelText = soundDisplayNames[soundKey] || path.parse(file).name;
        if (index > 0 && index % 5 === 0) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder();
        }
        const button = new ButtonBuilder()
            .setCustomId(`quickplay:${categoryName}:${file}`)
            .setLabel(labelText)
            .setStyle(buttonStyle);
        const buttonKey = `${categoryName}/${file}`;
        const buttonSpecificEmoji = buttonEmojis[buttonKey];
        if (buttonSpecificEmoji && typeof buttonSpecificEmoji === 'string') {
            try {
                button.setEmoji(buttonSpecificEmoji.trim());
            } catch (err) {
                console.error(`Nieprawidłowe emoji dla ${buttonKey}:`, err)
            }
        }
        currentRow.addComponents(button);
    });
    if (currentRow.components.length > 0) rows.push(currentRow);
    return { embeds: [embed], components: rows };
}

async function updateMainPanel(member = null) {
    if (!mainPanelMessageRef) return;
    try {
        await mainPanelMessageRef.edit(buildMainDashboard(member));
    } catch (error) {
        if (error.code === 10008) {
            const channel = mainPanelMessageRef.channel;
            mainPanelMessageRef = null;
            if (channel) {
                try {
                    mainPanelMessageRef = await channel.send(buildMainDashboard(member));
                } catch (e) {
                    console.error('Nie udało się zaktualizować panelu!:', e);
                }
            }
        } else {
            console.error('Nie udało się zaktualizować gł. panelu!:', error);
        }
    }
}

async function renderFullSoundboard(channel) {
    if (!fs.existsSync(SOUNDS_DIR)) fs.mkdirSync(SOUNDS_DIR, { recursive: true });
    if (channel?.guild) await syncLocalIconsToGuild(channel.guild);
    if (mainPanelMessageRef) {
        try {
            await mainPanelMessageRef.delete();
        } catch (err) {}
        mainPanelMessageRef = null;
    }
    for (const [, msgRef] of categoryMessageRefs.entries()) {
        try {
            await msgRef.delete();
        } catch (error) {}
    }
    categoryMessageRefs.clear();
    const currentCategories = fs.readdirSync(SOUNDS_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory() && !hiddenCategories.has(d.name))
        .map(d => d.name);
    for (const cat of currentCategories) {
        const msgData = buildCategoryMessage(cat);
        const newMsg = await channel.send(msgData);
        categoryMessageRefs.set(cat, newMsg);
    }
    const mainDash = buildMainDashboard();
    mainPanelMessageRef = await channel.send(mainDash);
    saveConfig();
}

async function restorePanelReferences(client) {
    if (!fs.existsSync(CONFIG_PATH)) return;
    try {
        const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
        if (data.mainPanelRef) {
            const channel = await client.channels.fetch(data.mainPanelRef.channelId).catch(() => null);
            if (channel) {
                mainPanelMessageRef = await channel.messages.fetch(data.mainPanelRef.messageId).catch(() => null);
                if (mainPanelMessageRef) {
                    console.log('[System] Pomyślnie przywrócono referencję Głównego Panelu po restarcie');
                    await updateMainPanel();
                }
            }
        }
    } catch (err) {
        console.error('[System] Błąd podczas przywracania panelu:', err);
    }
}

module.exports = {
    categoryNames,
    categoryColors,
    normalizedFiles,
    categoryEmojis,
    buttonEmojis,
    hiddenCategories,
    saveConfig,
    syncLocalIconsToGuild,
    buildMainDashboard,
    buildCategoryMessage,
    restorePanelReferences,
    updateMainPanel,
    renderFullSoundboard
};