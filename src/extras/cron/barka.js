const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const {
    SOUNDS_DIR,
    playSoundTrack,
    isBarkaEnabled
} = require('../../audio/playerService');

const BARKA_CHANNEL_ID = process.env.BARKA_CHANNEL_ID;

function setupBarkaCron(client) {
    cron.schedule('37 21 * * *', async () => {
        if (!isBarkaEnabled) {
            console.log('[BARKA] Pomijanie Barki - dodatek wyłączony');
            return;
        }
        console.log('[21:37 BARKA] Wybiła 21:37! Losujemy Barkę...');
        if (!BARKA_CHANNEL_ID) {
            console.error('[BARKA] Błąd: Brak ustawionego BARKA_CHANNEL_ID w .env');
            return;
        }
        const barkaDir = path.join(SOUNDS_DIR, 'barka');
        if (!fs.existsSync(barkaDir)) {
            console.error('[BARKA] Błąd: Katalog sounds/barka/ nie istnieje!');
            return;
        }
        const files = fs.readdirSync(barkaDir).filter(f => f.endsWith('.mp3') || f.endsWith('.wav'));
        if (files.length === 0) {
            console.error('[BARKA] Błąd: Brak plików audio w katalogu sounds/barka/');
            return;
        }
        try {
            const voiceChannel = await client.channels.fetch(BARKA_CHANNEL_ID);
            if (!voiceChannel || !voiceChannel.isVoiceBased()) {
                console.error('[BARKA] Błąd: Podane ID nie wskazuje na poprawny kanał głosowy');
                return;
            }
            const randomFile = files[Math.floor(Math.random() * files.length)];
            console.log(`[21:37 BARKA] Wbijam na kanał "${voiceChannel.name}" i odtwarzam: ${randomFile}`);
            playSoundTrack(voiceChannel, 'barka', randomFile, 'Papież (21:37)');
        } catch (error) {
            console.error('[BARKA] Błąd podczas dołączania do kanału:', error.message);
        }
    }, {
        timezone: "Europe/Warsaw"
    });
    console.log('[BARKA] Barka jest aktywna');
}
module.exports = { setupBarkaCron };