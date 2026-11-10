// ** Loading, Holding in Memory and Saving Configuration to JSON files ** //
const fs = require('fs');
const path = require('path');
const { 
    ButtonStyle
} = require('discord.js');
const { 
    SOUNDS_DIR
} = require('../audio/playerService');
const { 
    channel 
} = require('diagnostics_channel');

const CATEGORIES_PATH = path.join(__dirname, '../../config/categories.json');
const SETTINGS_PATH = path.join(__dirname, '../../config/settings.json');
const FAVORITES_PATH = path.join(__dirname, '../../config/favorites.json');

let userFavorites = {};
const categoryNames = {};
const soundDisplayNames = {};
const categoryColors = {};
const categoryEmojis = {};
const buttonEmojis = {};
const normalizedFiles = new Set();
let hiddenCategories = new Set();

function loadFavorites() {
    if (fs.existsSync(FAVORITES_PATH)) {
        try {
            const raw = fs.readFileSync(FAVORITES_PATH, 'utf8');
            userFavorites = JSON.parse(raw);
        } catch (error) {
            console.error('[CONFIG MANAGER] Błąd podczas odczytu favorites.json:', error);
            userFavorites = {};
        }
    }
}

function saveFavorites() {
    try {
        const configDir = path.dirname(FAVORITES_PATH);
        if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, {recursive:true});
        fs.writeFileSync(FAVORITES_PATH, JSON.stringify(userFavorites, null, 2), 'utf8');
    } catch (error) {
        console.error('[CONFIG MANAGER] Błąd podczas zapisu favorites.json:', error);
    }
}

function loadAndSyncConfig() {
    let savedData = {};
    if (fs.existsSync(CATEGORIES_PATH)) {
        try {
            savedData = JSON.parse(fs.readFileSync(CATEGORIES_PATH, 'utf-8'));
        } catch (err) {
            console.error('[CONFIG MANAGER] Błąd odczytu config/categories.json:', err);
        }
    }
    const savedCats = savedData.categories || {};
    if (savedData.hidden) hiddenCategories = new Set(savedData.hidden);
    const availableFolders = fs.existsSync(SOUNDS_DIR)
        ? fs.readdirSync(SOUNDS_DIR, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name)
        : [];
    for (const catFolder of availableFolders) {
        const catPath = path.join(SOUNDS_DIR, catFolder);
        const savedCat = savedCats[catFolder] || {};
        categoryNames[catFolder] = savedCat.displayName || catFolder.replace(/_/g, ' ').toUpperCase();
        categoryEmojis[catFolder] = savedCat.emoji || null;
        categoryColors[catFolder] = savedCat.color || 'Primary';
        const audioFiles = fs.existsSync(catPath)
            ? fs.readdirSync(catPath).filter(f => f.endsWith('.mp3') || f.endsWith('.wav'))
            : [];
        const savedSounds = savedCat.sounds || {};
        for (const file of audioFiles) {
            const soundKey = `${catFolder}/${file}`;
            const savedSound = savedSounds[file] || {};
            soundDisplayNames[soundKey] = savedSound.displayName || path.parse(file).name;
            buttonEmojis[soundKey] = savedSound.emoji || null;
            if (savedSound.normalized) normalizedFiles.add(soundKey);
        }
    }
    saveConfig();
}

function saveConfig(mainPanelMessageRef = null, categoryMessageRefs = new Map()) {
    try {
        let existingMainPanelRef = null;
        let existingCategoryRefs = {};
        if (fs.existsSync(CATEGORIES_PATH)) {
            try {
                const oldData = JSON.parse(fs.readFileSync(CATEGORIES_PATH, 'utf-8'));
                if (oldData.mainPanelRef) existingMainPanelRef = oldData.mainPanelRef;
                if (oldData.categoryRefs) existingCategoryRefs = oldData.categoryRefs; 
            } catch (e) {}
        }
        const categoriesPayload = {};
        const availableFolders = fs.existsSync(SOUNDS_DIR)
            ? fs.readdirSync(SOUNDS_DIR, { withFileTypes: true })
                .filter(d => d.isDirectory())
                .map(d => d.name)
            : [];
        for (const catFolder of availableFolders) {
            const catPath = path.join(SOUNDS_DIR, catFolder);
            const audioFiles = fs.existsSync(catPath)
                ? fs.readdirSync(catPath).filter(f => f.endsWith('.mp3') || f.endsWith('.wav'))
                : [];
            const soundsObj = {};
            for (const file of audioFiles) {
                const soundKey = `${catFolder}/${file}`;
                soundsObj[file] = {
                    displayName: soundDisplayNames[soundKey] || path.parse(file).name,
                    emoji: buttonEmojis[soundKey] || null,
                    normalized: normalizedFiles.has(soundKey)
                };
            }
            categoriesPayload[catFolder] = {
                displayName: categoryNames[catFolder] || catFolder,
                emoji: categoryEmojis[catFolder] || null,
                color: categoryColors[catFolder] || ButtonStyle.Primary,
                sounds: soundsObj
            };
        }
        const currentMainPanelRef = mainPanelMessageRef ? {
            channelId: mainPanelMessageRef.channel.id,
            messageId: mainPanelMessageRef.id,
        } : existingMainPanelRef;
        const currentCategoryRefs = categoryMessageRefs.size > 0 ? Object.fromEntries(
            Array.from(categoryMessageRefs.entries()).map(([cat, msg]) => [
                cat,
                { channelId: msg.channel.id, messageId: msg.id }
            ])
        ) : existingCategoryRefs;
        const payload = {
            categories: categoriesPayload,
            hidden: Array.from(hiddenCategories),
            mainPanelRef: currentMainPanelRef,
            categoryRefs: currentCategoryRefs
        }
        const configDir = path.dirname(CATEGORIES_PATH);
        if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(CATEGORIES_PATH, JSON.stringify(payload, null, 2), 'utf8');
    } catch (err) {
        console.error('[CONFIG MANAGER] Błąd podczas zapisu config/categories.json:', err);
    }
}

loadFavorites();

module.exports = {
    CATEGORIES_PATH,
    SETTINGS_PATH,
    FAVORITES_PATH,

    userFavorites,
    categoryNames,
    soundDisplayNames,
    categoryColors,
    categoryEmojis,
    buttonEmojis,
    normalizedFiles,
    hiddenCategories,
    
    loadFavorites,
    saveFavorites,
    loadAndSyncConfig,
    saveConfig
};