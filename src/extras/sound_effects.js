const fs = require('fs');
const path = require('path');
const {
    spawn
} = require('child_process');
const { getActiveTracks, guildSessions } = require('../audio/voiceSessionManager');

// TODO: CAN BE TAKEN FROM ANOTHER FUNCTION
const SETTINGS_PATH = path.join(__dirname, '../../config/settings.json');

const AUDIO_EFFECTS = {
    'bassboost': 'equalizer=f=60:width_type=h:width=100:g=10,bass=g=8',
    // 'nightcore': 'asetrate=48000*1.25,aresample=48000',
    'nightcore': 'asetrate=60000,aresample=48000',
    'vaporwave': 'asetrate=48000*0.8,aresample=48000,aecho=0.8:0.88:60:0.4',
    // 'speedup': 'atempo=1.5',
    'speedup': 'atempo=1.5',
    'slowed': 'atempo=0.85',
    'reverb': 'aecho=0.8:0.88:60:0.4',
    '8d': 'apulsator=mode=sine:hz=0.125',
    'earrape': 'volume=12dB,acontrast=15,volume=4dB',
    'earrape2': 'volume=12dB,asoftclip=type=atan:threshold=0.8:output=0.98,acontrast=15,volume=4dB,alimiter=limit=0.98:attack=1:release=20:level=false',
    'radio': 'highpass=f=1000,lowpass=f=3000,volume=8dB,acontrast=15',
    'telephone': 'highpass=f=400,lowpass=f=3500,volume=4dB',
    'underwater': 'lowpass=f=450,volume=5dB',
    'demon': 'asetrate=48000*0.65,atempo=1.53846,aresample=48000,aecho=0.8:0.88:30:0.3'
};

function getAudioEffectsConfig() {
    try {
        if (fs.existsSync(SETTINGS_PATH)) {
            const data = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
            return data.audioEffects || {};
        }
    } catch (error) {
        console.error('[CONFIG SOUND-EFFECTS] Błąd odczytu efektów z settings.json:', error);
    }
    return {};
}

function toggleAudioEffect(effectKey) {
    try {
        let settings = {};
        if (fs.existsSync(SETTINGS_PATH)) {
            try {
                settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
            } catch (error) { }
        }
        if (!settings.audioEffects)
            settings.audioEffects = {};
        settings.audioEffects[effectKey] = !settings.audioEffects[effectKey];
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
        applyEffectsToActiveTracksLive();
        return settings.audioEffects[effectKey];
    } catch (error) {
        console.error('[AUDIO-EFFECTS] Błąd zapisu efektu do settings.json', error);
        return false;
    }
}

function getActiveFFmpegFilters() {
    const activeConfig = getAudioEffectsConfig();
    const activeFilters = [];
    for (const [key, isEnabled] of Object.entries(activeConfig)) {
        if (isEnabled && AUDIO_EFFECTS[key])
            activeFilters.push(AUDIO_EFFECTS[key]);
    }
    return activeFilters.length > 0 ? activeFilters.join(',') : null;
}

function applyEffectsToActiveTracksLive(guildId = null) {

    const sessionsToProcess = [];

    if (guildId && guildSessions.has(guildId)) {

        sessionsToProcess.push(guildSessions.get(guildId));

    } else {

        for (const session of guildSessions.values()) {

            sessionsToProcess.push(session);

        }

    }

    const activeFilters = getActiveFFmpegFilters();

    for (const session of sessionsToProcess) {

        if (!session || !session.activeTracks || session.activeTracks.size === 0) continue;

        for (const [trackId, track] of session.activeTracks.entries()) {

            if (!track.filePath || !fs.existsSync(track.filePath)) continue;

            const elapsedSeconds = Math.max(0, (Date.now() - (track.startTime || track.startedAt || Date.now())) / 1000);

            if (track.process) {

                try {

                    if (track.process.stdout)

                        track.process.stdout.destroy();

                    track.process.kill('SIGKILL');

                } catch (error) { }

            }

            const ffmpegArgs = [

                '-loglevel', 'error',

                '-fflags', '+nobuffer+fastseek',

                '-flags', '+low_delay',

                '-re',

                '-ss', elapsedSeconds.toString(),

                '-vn', '-sn', '-dn',

                '-i', track.filePath

            ];

            if (activeFilters)

                ffmpegArgs.push('-af', activeFilters);

            ffmpegArgs.push(

                '-acodec', 'pcm_s16le',

                '-f', 's16le',

                '-ar', '48000',

                '-ac', '2',

                '-blocksize', '3840',

                'pipe:1'

            );

            const newProcess = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

            track.process = newProcess;

            if (session.mixer) {

                session.mixer.removeTrack(trackId);

                session.mixer.addTrack(trackId, newProcess.stdout);

            }

        }

    }

}

module.exports = {
    AUDIO_EFFECTS,
    getAudioEffectsConfig,
    toggleAudioEffect,
    getActiveFFmpegFilters,
    applyEffectsToActiveTracksLive
};