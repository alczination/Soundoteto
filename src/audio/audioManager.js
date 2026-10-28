// Module to manage Discord Voice Engine, Player, FFmpeg Processes and Track State
const fs = require('fs');
const path = require('path');
const LOG_FILE = path.join(__dirname, '../../soundboard.log');
const { spawn } = require('child_process');
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    StreamType
} = require('@discordjs/voice');
// Connection to AudioMixer.js
const AudioMixer = require('./AudioMixer');
const guildSessions = new Map();
const { disconnect } = require('cluster');
const { clear } = require('console');
const SOUNDS_DIR = path.join(__dirname, '../../sounds');

function getGuildSession(guildId, voiceChannel) {
    if (!guildSessions.has(guildId)) {
        const mixer = new AudioMixer();
        const player = createAudioPlayer();
        mixer.onTrackEnd = (trackId) => {
            const session = guildSessions.get(guildId);
            if (session) {
                session.activeTracks.delete(trackId);
            }
        };
        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: guildId,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        });
        connection.subscribe(player);
        const mixerResource = createAudioResource(mixer, { inputType: StreamType.Raw });
        player.play(mixerResource);
        guildSessions.set(guildId, {
            connection,
            mixer,
            player,
            activeTracks: new Map()
        });
    }
    return guildSessions.get(guildId);
}

let disconnectTimer = null;
let emptyChannelTimer = null;
let autoDisconnectDelayMs = 10 * 60 * 1000;

function setAutoDisconnectMinutes(minutes) {
    if (minutes <= 0) {
        autoDisconnectDelayMs = 0;
        clearDisconnectTimer();
    } else {
        autoDisconnectDelayMs = minutes * 60 * 1000;
        resetDisconnectTimer();
    }
}

function clearDisconnectTimer(session) {
    if (session & session.disconnectTimer) {
        clearTimeout(session.disconnectTimer);
        session.disconnectTimer = null;
    }
}

function resetDisconnectTimer(guildId) {
    const session = guildSessions.get(guildId);
    if (!session) return;
    clearDisconnectTimer(session);
    if (session.connection && session.activeTracks.size === 0) {
        disconnectTimer = setTimeout(() => {
            if (session.connection && session.activeTracks.size === 0) {
                console.log(`[Autodisconnect] Rozłączono bota z powodu nieaktywności na ${guildId}`);
                stopAllTracks(guildId);
                if (session.connection) {
                    session.connection.destroy();
                    session.connection = null;
                }
            }
        }, autoDisconnectDelayMs);
    }
}

function handleVoiceStateChange(oldState, newState) {
    const guildId = newState.guild.id;
    const session = guildSessions.get(guildId);
    if (!session || !session.disconnect) return;
    const channelId = session.connection.joinConfig.channelId;
    const voiceChannel = newState.guild.channels.cache.get(channelId);
    if (!voiceChannel) return;
    const humanMembers = voiceChannel.members.filter(member => !member.user.bot);
    if (humanMembers.size === 0) {
        if (!session.emptyChannelTimer) {
            console.log('[Autodisconnect] Kanał głosowy pusty. Uruchamianie timera...');
            const delay = Math.min(autoDisconnectDelayMs || 60000, 60000);
            session.emptyChannelTimer = setTimeout(() => {
                if (session.voiceConnection) {
                    const currentChannel = newState.guild.channels.cache.get(channelId);
                    const currentHumans = currentChannel?.members.filter(m => !m.user.bot);
                    if (!currentHumans || currentHumans.size === 0) {
                        console.log('[Autodisconnect] Rozłączono - pusty kanał');
                        stopAllTracks(guildId);
                        if (session.connection) {
                            session.connection.destroy();
                            session.connection = null;
                        }
                    }
                }
                session.emptyChannelTimer = null;
            }, delay)
        }
    } else {
        if (session.emptyChannelTimer) {
            clearTimeout(session.emptyChannelTimer);
            session.emptyChannelTimer = null;
            console.log('[Autodisconnect] Użytkownik na kanale. Stopowanie timera...');
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
    setAutoDisconnectMinutes,
    resetDisconnectTimer,
    clearDisconnectTimer,
    handleVoiceStateChange,
    playSoundTrack,
    stopSingleTrack,
    stopAllTracks
};

