// ** I/O Operations on `settings.json` from `audioManager.js` ** //
const fs = require('fs');
const path = require('path');
const SETTINGS_PATH = path.join(__dirname, '../../config/settings.json');

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_PATH)) {
            const data = fs.readFileSync(SETTINGS_PATH, 'utf8');
            const json = JSON.parse(data);
            if (typeof json.autoDisconnectMinutes === 'number') {
                return json.autoDisconnectMinutes * 60 * 1000;
            }
        }
    } catch (err) {
        console.error('Błąd podczas odczytu config/settings.json:', err);
    }
    return 10 * 60 * 1000;
}

function saveSettings(minutes) {
    try {
        const configDir = path.dirname(SETTINGS_PATH);
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        let settings = {};
        if (fs.existsSync(SETTINGS_PATH)) {
            try {
                settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
            } catch (e) { }
        }
        settings.autoDisconnectMinutes = minutes;
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
        console.log(`[AUTODISCONNECT] Zapisano nowy czas autodisconnect: ${minutes} min w config/settings.json`);
    } catch (err) {
        console.error('[CONFIG MANAGER] Błąd podczas zapisu config/settings.json:', err);
    }
}

function saveAutoDisconnectMinutes(minutes) {
    try {
        const configDir = path.dirname(SETTINGS_PATH);
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        let settings = {};
        if (fs.existsSync(SETTINGS_PATH)) {
            try { settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')); } catch (e) { }
        }
        settings.autoDisconnectMinutes = minutes;
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
        console.log(`[AUTODISCONNECT] Zapisano nowy czas: ${minutes} min`);
    } catch (err) {
        console.error('[CONFIG MANAGER] Błąd podczas zapisu config/settings.json:', err);
    }
}

function isBarkaEnabled() {
    try {
        if (fs.existsSync(SETTINGS_PATH)) {
            const data = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
            return data.addons?.barka2137Enabled ?? true;
        }
    } catch (error) {
        console.error('[EXTRAS] Błąd odczytu stanu DODATKI: BARKA -', err);
    }
    return true;
}

function setBarkaEnabled(status) {
    try {
        let settings = {};
        if (fs.existsSync(SETTINGS_PATH))
            settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
        if (!settings.addons) settings.addons = {};
        settings.addons.barka2137Enabled = status;
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
        console.log(`[CONFIG] ADDON Barka został: ${status ? 'WŁĄCZONY' : 'WYŁĄCZONY'}`);
        return true;
    } catch (error) {
        console.error('[CONFIG] Błąd zapisu stanu Barki:', error);
        return false;
    }
}

function getPlaybackMode() {
    try {
        if (fs.existsSync(SETTINGS_PATH)) {
            const data = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
            return data.playbackMode || 'mix';
        }
    } catch (error) {
        console.error('Błąd odczytu trybu odtwarzania', error);
    }
    return 'mix';
}

function setPlaybackMode(mode) {
    try {
        let settings = {};
        if (fs.existsSync(SETTINGS_PATH))
            settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
        settings.playbackMode = mode;
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('Błąd zapisu trybu odtwarzania:', error);
        return false;
    }
}

function switchPlaybackMode(targetMode, guildId = null) {
    setPlaybackMode(targetMode);
    const {
        audioQueue,
        stopSingleTrack
    } = require('../audio/playerService');
    const {
        getActiveTracks
    } = require('../audio/voiceSessionManager');
    if (targetMode === 'mix') {
        audioQueue.length = 0;
        console.log(`[MODE] Przełączono na MIX. Czyszczenie zakolejkowanych utworów.`);
    } else if (targetMode === 'queue') {
        let removedCount = 0;
        if (guildId) {
            const tracksMap = getActiveTracks(guildId);
            if (tracksMap && tracksMap.size > 1) {
                const entries = [...tracksMap.entries()];
                for (let i = 1; i < entries.length; i++) {
                    const [trackId] = entries[i];
                    stopSingleTrack(guildId, trackId);
                }
                removedCount = entries.length - 1;
            }
        }
        console.log(`[MODE] Przełączono na QUEUE. Zachowywanie 1. utworu i czyszczenie reszty (${removedCount}).`);
    }
    return targetMode;
}

module.exports = {
    loadSettings,
    saveSettings,
    saveAutoDisconnectMinutes,
    isBarkaEnabled,
    setBarkaEnabled,
    getPlaybackMode,
    setPlaybackMode,
    switchPlaybackMode
};