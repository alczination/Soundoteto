// ** Central components connector ** //
const fs = require('fs');
const path = require('path');

const {
    getActiveTracks
} = require('../audio/voiceSessionManager');
const {
    SOUNDS_DIR
} = require('../audio/playerService');
const {
    buildMainDashboard
} = require('./dashboardBuilder');
const {
    syncLocalIconsToGuild,
    buildUserFavoritesMessage,
    buildCategoryMessage
} = require('./soundboardBuilder');
const {
    userFavorites,
    categoryNames,
    categoryColors,
    categoryEmojis,
    buttonEmojis,
    soundDisplayNames,
    hiddenCategories,
    saveConfig
} = require('./configManager');

const config = require('./configManager');
const CATEGORIES_PATH = path.join(__dirname, '../../config/categories.json');

let mainPanelMessageRef = null;
const categoryMessageRefs = new Map();
let isUpdatingMainPanel = false;
let panelTickerInterval = null;

config.loadAndSyncConfig();

function saveConfigWrapper() {
    config.saveConfig(mainPanelMessageRef, categoryMessageRefs);
}

function startPanelTicker(intervalMs = 30000) {
    if (panelTickerInterval) clearInterval(panelTickerInterval);
    panelTickerInterval = setInterval(async () => {
        if (mainPanelMessageRef) {
            await updateMainPanel().catch(() => {});
        }
    }, intervalMs);
    console.log(`[UI BUILDER] Ticker start`);
}

async function updateMainPanel(member = null) {
    if (!mainPanelMessageRef || isUpdatingMainPanel) return;
    isUpdatingMainPanel = true;
    try {
        const updatedDashboard = buildMainDashboard(member);
        await mainPanelMessageRef.edit(updatedDashboard);
    } catch (error) {
        if (error.code === 10008) {
            console.warn('[UI BUILDER] Wykryto usunięcie panelu. Rebuild...');
            mainPanelMessageRef = null;
            if (typeof restorePanelReferences === 'function') {
                const client = mainPanelMessageRef?.client;
                if (client) await restorePanelReferences(client);
            }
        } else {
            console.error('[UI BUILDER] Nie udało się zaktualizować gł. panelu!:', error);
        }
    } finally {
        isUpdatingMainPanel = false;
    }
}

async function updateCategoryMessage(channel, categoryFolder) {
    if (!categoryFolder) return;
    const msgData = buildCategoryMessage(categoryFolder);
    if (categoryMessageRefs.has(categoryFolder)) {
        try {
            const existingMsg = categoryMessageRefs.get(categoryFolder);
            await existingMsg.edit(msgData);
        } catch (error) {
            const newMsg = await channel.send(msgData);
            categoryMessageRefs.set(categoryFolder, newMsg);
        }
    } else {
        const newMsg = await channel.send(msgData);
        categoryMessageRefs.set(categoryFolder, newMsg);
    }
    if (typeof saveConfig === 'function')
        saveConfig();
}

async function renderFullSoundboard(channel) {
    if (!fs.existsSync(SOUNDS_DIR)) fs.mkdirSync(SOUNDS_DIR, { recursive: true });
    if (channel?.guild) await syncLocalIconsToGuild(channel.guild);

    const baseIconDir = path.join(__dirname, '../../ico');
    if (baseIconDir && typeof baseIconDir === 'string') {
        if (!fs.existsSync(baseIconDir)) {
            fs.mkdirSync(baseIconDir, { recursive: true });
        }
    }
    if (channel?.guild) await syncLocalIconsToGuild(channel.guild);
    if (mainPanelMessageRef) {
        try {
            await mainPanelMessageRef.delete();
        } catch (error) { }
        mainPanelMessageRef = null;
    }
    for (const [, msgRef] of categoryMessageRefs.entries()) {
        try {
            await msgRef.delete();
        } catch (error) { }
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
    if (typeof saveConfig === 'function') saveConfig();
}

async function restorePanelReferences(client) {
    if (!fs.existsSync(CATEGORIES_PATH)) return;
    try {
        const data = JSON.parse(fs.readFileSync(CATEGORIES_PATH, 'utf-8'));
        if (data.categoryRefs) {
            for (const [catName, ref] of Object.entries(data.categoryRefs)) {
                const channel = await client.channels.fetch(ref.channelId).catch(() => null);
                if (channel) {
                    const msg = await channel.messages.fetch(ref.messageId).catch(() => null);
                    if (msg) categoryMessageRefs.set(catName, msg);
                }
            }
        }
        let targetChannel = null;
        if (data.mainPanelRef?.channelId) {
            targetChannel = await client.channels.fetch(data.mainPanelRef.channelId).catch(() => null);
            if (targetChannel && data.mainPanelRef.messageId) {
                const oldMainMsg = await targetChannel.messages.fetch(data.mainPanelRef.messageId).catch(() => null);
                if (oldMainMsg) {
                    try {
                        await oldMainMsg.delete();
                        console.log('[UI BUILDER] Usunięto stary panel z czatu');
                    } catch (error) { }
                }
            }
        } else if (categoryMessageRefs.size > 0) {
            targetChannel = categoryMessageRefs.values().next().value?.channel || null;
        }
        if (targetChannel) {
            mainPanelMessageRef = null;
            const mainDash = buildMainDashboard();
            mainPanelMessageRef = await targetChannel.send(mainDash);
            // if (typeof saveConfig === 'function') saveConfig(mainPanelMessageRef, categoryMessageRefs);
            saveConfig();
            console.log('[UI BUILDER] Pomyślnie zbudowano Panel na nowo po restarcie');
        }
    } catch (error) {
        console.error('[UI BUILDER] Błąd podczas przywracania referencji panelu:', error);
    }
}

module.exports = {
    userFavorites: config.userFavorites,
    saveFavorites: config.saveFavorites,
    categoryNames: config.categoryNames,
    categoryColors: config.categoryColors,
    categoryEmojis: config.categoryEmojis,
    buttonEmojis: config.buttonEmojis,
    soundDisplayNames: config.soundDisplayNames,
    normalizedFiles: config.normalizedFiles,
    hiddenCategories: config.hiddenCategories,
    saveConfig: config.saveConfig,

    // UI-Views
    buildUserFavoritesMessage,
    buildMainDashboard,
    buildCategoryMessage,
    syncLocalIconsToGuild,

    // Cycle Panel
    categoryMessageRefs,
    startPanelTicker,
    restorePanelReferences,
    updateMainPanel,
    updateCategoryMessage,
    renderFullSoundboard
};