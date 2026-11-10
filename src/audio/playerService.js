// ** Related with starting playing sound handler **
const fs = require('fs');
const path = require('path');
const {
    PollyClient,
    SynthesizeSpeechCommand
} = require('@aws-sdk/client-polly');
const { Readable } = require('stream');
const {
    createAudioResource,
    AudioPlayerStatus,
    StreamType
} = require('@discordjs/voice');
const {
    spawn
} = require('child_process');
const {
    guildSessions,
    resetDisconnectTimer,
    stopAllTracks,
} = require('./voiceSessionManager');
const {
    getPlaybackMode
} = require('../config/settingsManager');
const {
    durationCache,
    getDurationMs
} = require('./audioUtils');
const {
    recordSoundUsage
} = require('../utils/statsManager');
const {
    updateMainPanel
} = require('../ui/uiBuilders');
const {
    getActiveFFmpegFilters
} = require('../extras/sound_effects');
const { clear } = require('console');
const { text } = require('stream/consumers');

const LOG_FILE = path.join(__dirname, '../../soundboard.log');
const SOUNDS_DIR = path.join(__dirname, '../../sounds');
const audioQueue = [];
const pollyClient = new PollyClient({ region: 'eu-central-1' });

function logActivity(userTag, category, file) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const logMessage = `[${timestamp}] User: ${userTag} | Category: ${category} | File: ${file}\n`;
    try {
        fs.appendFileSync(LOG_FILE, logMessage, 'utf8');
    } catch (err) {
        console.error('Błąd zapisu .log:', err);
    }
}

function playStreamTrack(voiceChannel, streamQueryOrUrl, displayTitle, userTag, streamCategory) {
    const guildId = voiceChannel.guild.id;
    const session = getGuildSession(guildId, voiceChannel);
    clearDisconnectTimer(guildId);
    const trackId = `stream_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const cookiesPath = path.join(__dirname, '../../cookies.txt');
    const cookiesFlag = fs.existsSync(cookiesPath) ? `--cookies "${cookiesPath}"` : '';
    console.log('[FFMPEG]:', cookiesPath);
    console.log('[FFMPEG]:', fs.existsSync(cookiesPath));
    const ytdlpProcess = spawn('yt-dlp', [
        '--no-warnings',
        '--no-playlist',
        '--js-runtimes', 'node',
        '--buffer-size', '16k',
        ...(cookiesFlag ? ['--cookies', cookiesPath] : []),
        '-f', 'ba/b',
        '-o', '-',
        streamQueryOrUrl
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    const ffmpegArgs = [
        '-loglevel', 'error',
        '-re',
        '-vn', '-sn', '-dn',
        '-i', 'pipe:0'
    ];
    const activeFilters = typeof getActiveFFmpegFilters === 'function' ? getActiveFFmpegFilters() : null;
    if (activeFilters) {
        ffmpegArgs.push('-af', activeFilters);
    }
    ffmpegArgs.push(
        '-acodec', 'pcm_s16le',
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
        'pipe:1'
    );
    const ffmpegProcess = spawn('ffmpeg', ffmpegArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    ytdlpProcess.stdout.pipe(ffmpegProcess.stdin);
    ffmpegProcess.stderr.on('data', (data) => console.error('[FFmpeg ERROR]:', data.toString()));
    ffmpegProcess.stdin.on('error', (error) => {
        if (error.code === 'EPIPE') {
            return;
        }
        console.error('[FFmpeg stdin ERROR]:', error)
    });
    ytdlpProcess.stderr.on('data', (data) => {
        const msg = data.toString();
        if (msg.includes('ERROR:')) {
            console.error('[yt-dlp Real Error]:', msg);
        }
    });
    ytdlpProcess.stdout.on('error', (error) => {
        if (error.code === 'EPIPE') {
            return;
        }
        console.error('[yt-dlp stdout ERROR]:', error);
    });
    session.mixer.addTrack(trackId, ffmpegProcess.stdout);
    session.activeTracks.set(trackId, {
        id: trackId,
        file: displayTitle,
        category: streamCategory,
        userTag,
        process: ffmpegProcess,
        ytdlpProcess
    });

    return trackId;
}

function startAudioStream(session, trackData) {
    if (!session) return null;
    const { voiceChannel, category, file, userTag, userId, avatarUrl } = trackData;
    const filePath = path.join(SOUNDS_DIR, category, file);
    const trackId = `track_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    logActivity(userTag, category, file);
    console.log(`[FFMPEG] Odtwarzanie dźwięku "${file}" z kategorii "${category}" (przez: ${userTag})`);

    const cachedDurationMs = durationCache.get(filePath) || 0;
    const durationInSeconds = cachedDurationMs > 0 ? cachedDurationMs / 1000 : 0;

    if (typeof recordSoundUsage === 'function')
        recordSoundUsage(userId, userTag, category, file, durationInSeconds);

    const ffmpegArgs = [
        '-loglevel', 'error',
        '-re',
        '-vn', '-sn', '-dn',
        '-i', filePath,
    ];

    const activeFilters = typeof getActiveFFmpegFilters === 'function' ? getActiveFFmpegFilters() : null;
    if (activeFilters) {
        ffmpegArgs.push('-af', activeFilters);
    }

    ffmpegArgs.push(
        '-acodec', 'pcm_s16le',
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
        'pipe:1'
    );

    const ffmpegProcess = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

    ffmpegProcess.stderr.on('data', (data) => {
        console.error(`[FFmpeg Error]: ${data.toString()}`);
    });
    ffmpegProcess.on('error', (err) => console.error('[FFmpeg ERROR] Błąd FFmpeg:', err));

    session.mixer.addTrack(trackId, ffmpegProcess.stdout);
    session.activeTracks.set(trackId, {
        id: trackId,
        file,
        category,
        filePath,
        startTime: Date.now(),
        startedAt: Date.now(),
        userTag,
        userId,
        avatarUrl,
        process: ffmpegProcess,
        duration: cachedDurationMs
    });

    if (session.player && session.player.state.status === AudioPlayerStatus.Idle) {
        const mixerResource = createAudioResource(session.mixer, { inputType: StreamType.Raw });
        session.player.play(mixerResource);
    }
    if (session.player)
        session.player.unpause();

    if (typeof durationCache !== 'undefined' && !durationCache.has(filePath)) {
        if (typeof getDurationMs === 'function') {
            getDurationMs(filePath).then(ms => {
                if (ms > 0) {
                    durationCache.set(filePath, ms);
                    const t = session.activeTracks.get(trackId);
                    if (t) {
                        t.duration = ms;
                    }
                }
            }).catch(error => {
                console.error('[Duration ERROR]:', error);
            });
        }
    }
    const { updateMainPanel } = require('../ui/uiBuilders');
    updateMainPanel({ guild: voiceChannel.guild }).catch(() => { });
    return trackId;
}

function flushAudioQueue(guildId) {
    if (!guildId) return;
    const session = guildSessions.get(guildId);
    if (!session) return;
    while (audioQueue && audioQueue.length > 0) {
        const nextTrack = audioQueue.shift();
        startAudioStream(session, nextTrack);
    }
}

function playSoundTrack(voiceChannel, category, file, userTag, userId) {
    const guildId = voiceChannel.guild.id;
    const { getGuildSession, clearDisconnectTimer } = require('./voiceSessionManager');
    
    clearDisconnectTimer(guildId);
    const session = getGuildSession(guildId, voiceChannel);
    if (!session) return null;

    const filePath = path.join(SOUNDS_DIR, category, file);
    const trackId = `track_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    logActivity(userTag, category, file);

    const cachedDurationMs = durationCache.get(filePath) || 0;
    const durationInSeconds = cachedDurationMs > 0 ? cachedDurationMs / 1000 : 0;

    if (typeof recordSoundUsage === 'function') {
        recordSoundUsage(userId, userTag, category, file, durationInSeconds);
    }

    const ffmpegArgs = [
        '-loglevel', 'error',
        '-re',
        '-vn', '-sn', '-dn',
        '-i', filePath
    ];

    const activeFilters = typeof getActiveFFmpegFilters === 'function' ? getActiveFFmpegFilters() : null;
    if (activeFilters) {
        ffmpegArgs.push('-af', activeFilters);
    }

    ffmpegArgs.push(
        '-acodec', 'pcm_s16le',
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
        'pipe:1'
    );

    const ffmpegProcess = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

    ffmpegProcess.stderr.on('data', (data) => {
        console.error(`[FFmpeg Error]: ${data.toString()}`);
    });
    ffmpegProcess.on('error', (err) => console.error('[FFmpeg ERROR] Błąd FFmpeg:', err));

    session.mixer.addTrack(trackId, ffmpegProcess.stdout);
    session.activeTracks.set(trackId, {
        id: trackId,
        file,
        category,
        filePath,
        startTime: Date.now(),
        startedAt: Date.now(),
        userTag,
        userId,
        process: ffmpegProcess,
        duration: cachedDurationMs
    });

    if (session.player && session.player.state.status === AudioPlayerStatus.Idle) {
        const mixerResource = createAudioResource(session.mixer, { inputType: StreamType.Raw });
        session.player.play(mixerResource);
    }
    if (session.player) {
        session.player.unpause();
    }

    if (typeof durationCache !== 'undefined' && !durationCache.has(filePath)) {
        if (typeof getDurationMs === 'function') {
            getDurationMs(filePath).then(ms => {
                if (ms > 0) {
                    durationCache.set(filePath, ms);
                    const t = session.activeTracks.get(trackId);
                    if (t) {
                        t.duration = ms;
                    }
                }
            }).catch(error => {
                console.error('[Duration ERROR]:', error);
            });
        }
    }

    if (typeof updateMainPanel === 'function') {
        updateMainPanel({ guild: voiceChannel.guild }).catch(() => {});
    }
    return trackId;
}

function stopSingleTrack(guildId, trackId) {
    const session = guildSessions.get(guildId);
    if (!session) return;
    const track = session.activeTracks.get(trackId);
    if (track) {
        session.mixer.removeTrack(trackId);
        if (track.ytdlpProcess) {
            try {
                if (track.ytdlpProcess.stdout) {
                    track.ytdlpProcess.stdout.unpipe();
                    track.ytdlpProcess.stdout.destroy();
                }
                track.ytdlpProcess.kill('SIGKILL');
            } catch (e) { }
        }
        if (track.process) {
            try {
                if (track.process.stdout) track.process.stdout.destroy();
                if (track.process.stdin) track.process.stdin.destroy();
                track.process.kill('SIGKILL');
            } catch (err) { }
        }
        session.mixer.removeTrack(trackId);
        session.activeTracks.delete(trackId);
        if (typeof resetDisconnectTimer === 'function') resetDisconnectTimer(guildId);
    }
}

async function playTTSTrack(voiceChannel, textToSpeech, voiceId = 'Jacek', userTag) {
    const guildId = voiceChannel.guild.id;
    const session = getGuildSession(guildId, voiceChannel);
    if (typeof clearDisconnectTimer === 'function')
        clearDisconnectTimer(guildId);

    const selectedVoice = (voiceId && typeof voiceId === 'string') ? voiceId : 'Jacek';
    const trackId = `tts_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const ssmlText = `<speak><break time="550ms"/>${textToSpeech}</speak>`;
    const shortText = textToSpeech.length > 25 ? textToSpeech.substring(0, 25) + '...' : textToSpeech;
    const fileDisplay = `🗣️ TTS (${selectedVoice}): "${shortText}"`;

    try {
        const command = new SynthesizeSpeechCommand({
            OutputFormat: 'mp3',
            Text: ssmlText,
            TextType: 'ssml',
            VoiceId: selectedVoice,
            LanguageCode: 'pl-PL',
            Engine: 'standard'
        });
        const response = await pollyClient.send(command);
        const audioStream = response.AudioStream;
        if (!audioStream)
            throw new Error('Brak strumienia z AWS Polly');

        const ffmpegProcess = spawn('ffmpeg', [
            '-loglevel', 'error',
            '-vn', '-sn', '-dn',
            '-i', 'pipe:0',
            '-af', 'volume=2.5',
            '-acodec', 'pcm_s16le',
            '-f', 's16le',
            '-ar', '48000',
            '-ac', '2',
            'pipe:1'
        ], { stdio: ['pipe', 'pipe', 'pipe'] });
        audioStream.pipe(ffmpegProcess.stdin);
        ffmpegProcess.stdin.on('error', (err) => {
            if (err.code !== 'EPIPE') console.error('[FFmpeg stdin Error]:', err);
        });
        ffmpegProcess.stderr.on('data', (data) => console.error('[FFmpeg Error]:', data.toString()));
        session.mixer.addTrack(trackId, ffmpegProcess.stdout);
        if (session.player) {
            if (session.player.state.status === AudioPlayerStatus.Idle) {
                const mixerResource = createAudioResource(session.mixer, { inputType: StreamType.Raw });
                session.player.play(mixerResource);
            }
            session.player.unpause();
        }
        session.activeTracks.set(trackId, {
            id: trackId,
            file: fileDisplay,
            category: 'TTS',
            userTag,
            startedAt: Date.now(),
            duration: 0,
            ffmpegProcess
        });
        return trackId;
    } catch (error) {
        console.error('[AWS Polly SDK Error]:', error);
        throw error;
    }
}

module.exports = {
    SOUNDS_DIR,
    LOG_FILE,
    audioQueue,
    playSoundTrack,
    startAudioStream,
    flushAudioQueue,
    playStreamTrack,
    stopSingleTrack,
    stopAllTracks,
    playTTSTrack,
};