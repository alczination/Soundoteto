// Module to manage Discord Voice Engine, Player, FFmpeg Processes and Track State
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    StreamType,
    VoiceConnectionStatus
} = require('@discordjs/voice');

// Connection to AudioMixer.js
const AudioMixer = require('./AudioMixer');
const SETTINGS_PATH = path.join(__dirname, '../../config/settings.json');
const LOG_FILE = path.join(__dirname, '../../soundboard.log');
const SOUNDS_DIR = path.join(__dirname, '../../sounds');
const guildSessions = new Map();
const { disconnect } = require('cluster');
const { clear } = require('console');
const { config } = require('dotenv');

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
            } catch (e) {}
        }
        settings.autoDisconnectMinutes = minutes;
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
        console.log(`[Autodisconnect] Zapisano nowy czas autodisconnect: ${minutes} min w config/settings.json`);
    } catch (err) {
        console.error('Błąd podczas zapisu config/settings.json:', err);
    }
}

function getGuildSession(guildId, voiceChannel) {
    let session = guildSessions.get(guildId);
    if (!session || !session.connection || session.connection.state.status === 'destroyed') {
        const mixer = session?.mixer || new AudioMixer();
        const player = session?.player || createAudioPlayer();
        player.removeAllListeners('error');
        player.on('error', error => {
            if (error.code === 'ERR_STREAM_PREMATURE_CLOSE') {
                console.warn(`[Audio] Przerwany strumień na serwerze ${guildId}. Odtwarzacz reset.`);
            } else {
                console.error(`[Audio Error] Błąd odtwarzacza na serwerze ${guildId}:`, error.message);
            }
        });
        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: guildId,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        });
        mixer.onTrackEnd = async (trackId) => {
            const currentSession = guildSessions.get(guildId);
            if (currentSession) {
                currentSession.activeTracks.delete(trackId);
                if (currentSession.activeTracks.size === 0)
                    resetDisconnectTimer(guildId);
            }
            try {
            const { updateMainPanel } = require('../ui/uiBuilders');
            await updateMainPanel({ guild: voiceChannel.guild });
            } catch (e) {}
        };
        connection.on(VoiceConnectionStatus.Disconnected, async () => {
            console.log(`[AUDIO] Bot został rozłączony z kanału głosowego: ${guildId}`);
            stopAllTracks(guildId);
            clearDisconnectTimer(guildId);
            try {
                connection.destroy();
            } catch (err) { }
            guildSessions.delete(guildId);
            try {
                const { updateMainPanel } = require('../ui/uiBuilders');
                await updateMainPanel({ guild: voiceChannel.guild });
            } catch (err) { }
        });
        connection.subscribe(player);
        const mixerResource = createAudioResource(mixer, { inputType: StreamType.Raw });
        player.play(mixerResource);
        session = {
            connection,
            mixer,
            player,
            activeTracks: session?.activeTracks || new Map(),
            disconnectTimer: null,
            emptyChannelTimer: null
        };
        guildSessions.set(guildId, session);
    } else if (session.connection.joinConfig.channelId !== voiceChannel.id) {
        session.connection.rejoin({
            channelId: voiceChannel.id,
            selfDeaf: true
        });
    }
    return session;
}

function getActiveTracks(guildId = null) {
    if (guildId && guildSessions.has(guildId)) {
        return guildSessions.get(guildId).activeTracks;
    }
    const combinedTracks = new Map();
    for (const session of guildSessions.values()) {
        if (session.activeTracks) {
            for (const [id, track] of session.activeTracks.entries()) {
                combinedTracks.set(id, track);
            }
        }
    }
    return combinedTracks;
}

let disconnectTimer = null;
let emptyChannelTimer = null;
let autoDisconnectDelayMs = loadSettings();

function setAutoDisconnectMinutes(minutes) {
    if (minutes <= 0) {
        autoDisconnectDelayMs = 0;
        saveSettings(0);
    } else {
        autoDisconnectDelayMs = minutes * 60 * 1000;
        saveSettings(minutes);
    }
    for (const [guildId, session] of guildSessions.entries()) {
        if (minutes <= 0) {
            clearDisconnectTimer(guildId);
            console.log(`[Autodisconnect] Zatrzymano timer nieaktywności na serwerze: ${guildId}`);
        } else {
            if (session.connection && session.activeTracks.size === 0) {
                console.log(`[Autodisconnect] Aktualizacja działającego timera do nowej wartości: ${minutes} min na serwerze: ${guildId}`);
                resetDisconnectTimer(guildId);
            }
        }
    }
 }

function getAutoDisconnectStatus(guildId) {
    const session = guildSessions.get(guildId);
    const setMinutes = autoDisconnectDelayMs / 60000;
    if (autoDisconnectDelayMs === 0) {
        return {
            enabled: false,
            minutes: 0,
            message: '⚙️ Automatyczne rozłączanie bota jest obecnie **wyłączone**.'
        };
    }
    let timerState = '⚪ **Bezczynny** — Bot nie przebywa na kanale głosowym';
    if (session) {
        if (session.emptyChannelTimer) {
            timerState = '🚨 **Aktywny** — Kanał jest pusty (odliczanie do wyjścia)';
        } else if (session.disconnectTimer) {
            timerState = '⏳ **Aktywny** — Brak odtwarzanych dźwięków (odliczanie bezczynności)';
        } else if (session.activeTracks && session.activeTracks.size > 0) {
            timerState = '🔊 **Wstrzymany** — Bot obecnie odtwarza dźwięk';
        } else {
            timerState = '🟢 **Połączono** — Oczekiwanie na akcję';
        }
    }
    return {
        enabled: true,
        minutes: setMinutes,
        message: `⚙️ **Status Auto-Disconnect:**\n` +
                 `• Ustawiony czas: **${setMinutes} min**\n` +
                 `• Stan timera: ${timerState}`
    };
}

function clearDisconnectTimer(guildIdOrSession) {
    let session = null;
    if (typeof guildIdOrSession === 'string') {
        session = guildSessions.get(guildIdOrSession);
    } else if (guildIdOrSession && typeof guildIdOrSession === 'object') {
        session = guildIdOrSession;
    }
    if (session && session.disconnectTimer) {
        console.log(`[Autodisconnect] Anulowano timer nieaktywności bota`);
        clearTimeout(session.disconnectTimer);
        session.disconnectTimer = null;
    }
}

function resetDisconnectTimer(guildId) {
    if (!guildId) return;
    const session = guildSessions.get(guildId);
    if (!session) return;
    clearDisconnectTimer(session);
    if (autoDisconnectDelayMs > 0 && session.connection && session.activeTracks.size === 0) {
        console.log(`[Autodisconnect] Uruchamianie timera odliczania (${autoDisconnectDelayMs / 60000} min) dla serwera: ${guildId}`);
        session.disconnectTimer = setTimeout(() => {
            if (session.connection && session.activeTracks.size === 0) {
                console.log(`[Autodisconnect] Rozłączono bota z powodu nieaktywności na ${guildId}`);
                stopAllTracks(guildId);
                if (session.connection) {
                    try {
                        session.connection.destroy();
                    } catch (e) { }
                    session.connection = null;
                }
                guildSessions.delete(guildId);
            }
        }, autoDisconnectDelayMs);
    }
}

function handleVoiceStateChange(oldState, newState) {
    const guildId = newState.guild?.id || oldState.guild?.id;
    if (!guildId) return;
    const session = guildSessions.get(guildId);
    if (!session || !session.connection) return;
    const channelId = session.connection.joinConfig.channelId;
    const voiceChannel = newState.guild.channels.cache.get(channelId);
    if (!voiceChannel) {
        console.log(`[VoiceState] Bot nie mógł odnaleźć kanału: ${channelId}`);
        return;
    }
    const humanMembers = voiceChannel.members.filter(member => !member.user.bot);
    console.log(`[VoiceState] Zmiana na "${voiceChannel.name}". Liczba ludzi: ${humanMembers.size}`);
    if (humanMembers.size === 0) {
        if (!session.emptyChannelTimer) {
            const delay = Math.min(autoDisconnectDelayMs || 60000, 60000);
            console.log('[Autodisconnect] Kanał głosowy pusty. Uruchamianie timera...');
            session.emptyChannelTimer = setTimeout(() => {
                if (session.connection) {
                    const currentChannel = newState.guild.channels.cache.get(channelId);
                    const currentHumans = currentChannel?.members.filter(m => !m.user.bot);
                    if (!currentHumans || currentHumans.size === 0) {
                        console.log(`[Autodisconnect] Minął czas opóźnienia. Bot opuszcza pusty kanał! GuildID: ${guildId}`);
                        stopAllTracks(guildId);
                        try {
                            session.connection.destroy();
                        } catch (e) { }
                        session.connection = null;
                        guildSessions.delete(guildId);
                    } else {
                        console.log(`[Autodisconnect] Anulowano wyjście - ktoś wszedł na kanał.`);
                    }
                }
                session.emptyChannelTimer = null;
            }, delay);
        } else {
            if (session.emptyChannelTimer) {
                console.log(`[Autodisconnect] Użytkownik wrócił na kanał. Stop timera.`)
                clearTimeout(session.emptyChannelTimer);
                session.emptyChannelTimer = null;
            }
        }
    }
}

function logActivity(userTag, category, file) {
    const timestamp = new Date().toISOString().replace('T', '').substring(0, 19);
    const logMessage = `[${timestamp}] User: ${userTag} | Category: ${category} | File: ${file}\n`;
    try {
        fs.appendFileSync(LOG_FILE, logMessage, 'utf8');
    } catch (err) {
        console.error('Błąd zapisu .log:', err);
    }
}

function playSoundTrack(voiceChannel, category, file, userTag) {
    const guildId = voiceChannel.guild.id;
    clearDisconnectTimer(guildId);
    const session = getGuildSession(guildId, voiceChannel);
    const filePath = path.join(SOUNDS_DIR, category, file);
    const trackId = `track_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    logActivity(userTag, category, file);
    const ffmpegProcess = spawn('ffmpeg', [
        '-loglevel', 'error',
        // Bugfix: Shutter at begin
        '-re',
        '-vn', '-sn', '-dn',
        '-i', filePath,
        // Sound Normalize
        /*
        '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
        */
        '-acodec', 'pcm_s16le',
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
        'pipe:1'
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    ffmpegProcess.stderr.on('data', (data) => {
        console.error(`[FFmpeg Error]: ${data.toString()}`);
    });
    ffmpegProcess.on('error', (err) => console.error('Błąd FFmpeg:', err));
    session.mixer.addTrack(trackId, ffmpegProcess.stdout);
    session.activeTracks.set(trackId, {
        id: trackId,
        file,
        category,
        userTag,
        process: ffmpegProcess
    });
    return trackId;
}

function stopSingleTrack(guildId, trackId) {
    const session = guildSessions.get(guildId);
    if (!session) return;
    const track = session.activeTracks.get(trackId);
    if (track) {
        session.mixer.removeTrack(trackId);
        if (track.process) {
            try {
                if (track.process.stdout) {
                    track.process.stdout.destroy();
                }
                track.process.kill('SIGKILL');
            } catch (err) {
                console.error(`Błąd podczas zamykania ${trackId}:`, err);
            }
        }
        session.mixer.removeTrack(trackId);
        session.activeTracks.delete(trackId);
        if (typeof resetDisconnectTimer === 'function') resetDisconnectTimer(guildId);
    }
}

function stopAllTracks(guildId) {
    const session = guildSessions.get(guildId);
    if (!session) return;
    for (const [id, track] of session.activeTracks.entries()) {
        if (track.process) {
            try {
                if (track.process.stdout) {
                    track.process.stdout.destroy();
                }
                track.process.kill('SIGKILL');
            } catch (err) {
                console.error(`Błąd podczas zamykania ${id}:`, err);
            }
        }
    }
    session.mixer.clear();
    session.activeTracks.clear();
}

module.exports = {
    SOUNDS_DIR,
    guildSessions,
    getActiveTracks,
    setAutoDisconnectMinutes,
    getAutoDisconnectStatus,
    resetDisconnectTimer,
    clearDisconnectTimer,
    handleVoiceStateChange,
    playSoundTrack,
    stopSingleTrack,
    stopAllTracks
};

