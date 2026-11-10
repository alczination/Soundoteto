const fs = require('fs');
const path = require('path');
const STATS_FILE = path.join(__dirname, '../../config/stats.json');

function loadStats() {
    if (!fs.existsSync(STATS_FILE)) {
        return { 
            totalPlayTimeSeconds: 0, 
            totalSoundsPlayed: 0, 
            sounds: {}, 
            users: {}, 
            categories: {} 
        };
    }
    try {
        const raw = fs.readFileSync(STATS_FILE, 'utf8');
        return JSON.parse(raw);
    } catch (err) {
        console.error('[STATS] Błąd odczytu stats.json:', err);
        return { totalPlayTimeSeconds: 0, totalSoundsPlayed: 0, sounds: {}, users: {}, categories: {} };
    }
}
function recordSoundUsage(userId, userTag, category, soundFile, durationSeconds = 0) {
    const stats = loadStats();
    const soundKey = `${category}/${soundFile}`;
    stats.totalSoundsPlayed = (stats.totalSoundsPlayed || 0) + 1;
    stats.totalPlayTimeSeconds = (stats.totalPlayTimeSeconds || 0) + durationSeconds;
    stats.sounds[soundKey] = (stats.sounds[soundKey] || 0) + 1;
    stats.categories[category] = (stats.categories[category] || 0) + 1;
    if (!stats.users[userId]) {
        stats.users[userId] = { tag: userTag, uses: 0 };
    }
    stats.users[userId].uses += 1;
    stats.users[userId].tag = userTag;
    try {
        const configDir = path.dirname(STATS_FILE);
        if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2), 'utf8');
    } catch (err) {
        console.error('[STATS] Błąd zapisu stats.json:', err);
    }
}

module.exports = { loadStats, recordSoundUsage };