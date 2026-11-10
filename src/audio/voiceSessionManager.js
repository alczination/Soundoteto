// ** Manages the Discord Voice Connections, Connection Cycle, guildSession Objects and Disconnect Timers ** //
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    StreamType,
    VoiceConnectionStatus
} = require('@discordjs/voice');
const AudioMixer = require('./AudioMixer');
const {
    loadSettings,
    saveSettings,
    getPlaybackMode
} = require('../config/settingsManager');
const {
    getUserIntros
} = require('../config/userIntrosManager');
const {
    playSoundTrack
} = require('../audio/playerService');
const {
    findCategory
} = require('../handlers/categoryHandler');
const {
    findAudioFile
} = require('../handlers/soundHandler');

const guildSessions = new Map();
let autoDisconnectDelayMs = loadSettings();

function clearDisconnectTimer(guildIdOrSession) {
    let session = null;
    if (typeof guildIdOrSession === 'string') {
        session = guildSessions.get(guildIdOrSession);
    } else if (guildIdOrSession && typeof guildIdOrSession === 'object') {
        session = guildIdOrSession;
    }
    if (session && session.disconnectTimer) {
        console.log(`[AUTODISCONNECT] Anulowano timer nieaktywności bota`);
        clearTimeout(session.disconnectTimer);
        session.disconnectTimer = null;
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
        if (track.ytdlpProcess) {
            try {
                if (track.ytdlpProcess.stdout) {
                    track.ytdlpProcess.stdout.destroy();
                }
                track.ytdlpProcess.kill('SIGKILL');
            } catch (error) { }
        }
    }
    session.mixer.clear();
    session.activeTracks.clear();
}

function resetDisconnectTimer(guildId) {
    if (!guildId) return;
    const session = guildSessions.get(guildId);
    if (!session) return;
    clearDisconnectTimer(session);
    if (autoDisconnectDelayMs > 0 && session.connection && session.activeTracks.size === 0) {
        console.log(`[AUTODISCONNECT] Uruchamianie timera odliczania (${autoDisconnectDelayMs / 60000} min) dla serwera: ${guildId}`);
        session.disconnectTimer = setTimeout(() => {
            if (session.connection && session.activeTracks.size === 0) {
                console.log(`[AUTODISCONNECT] Rozłączono bota z powodu nieaktywności na ${guildId}`);
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

function getGuildSession(guildId, voiceChannel = null) {
    let session = guildSessions.get(guildId);

    if (!session || !session.connection || session.connection.state.status === 'destroyed') {
        if (!voiceChannel) return null;

        const mixer = session?.mixer || new AudioMixer();
        const player = session?.player || createAudioPlayer();

        // <--- DEBUG PLAYER --->
        player.on('stateChange', (oldState, newState) => {
            console.log(`[FFMPEG] Zmiana stanu odtwarzacza: ${oldState.status} ➔ ${newState.status}`);
        });

        // Czyszczenie procesów + obsługa kolejki odtwarzania
        mixer.onTrackEnd = async (trackId) => {
            const currentSession = guildSessions.get(guildId);
            if (currentSession) {
                if (currentSession.activeTracks.has(trackId)) {
                    const finishedTrack = currentSession.activeTracks.get(trackId);
                    if (finishedTrack.ytdlpProcess) {
                        try { finishedTrack.ytdlpProcess.kill('SIGKILL'); } catch (e) { }
                    }
                    if (finishedTrack.process) {
                        try { finishedTrack.process.kill('SIGKILL'); } catch (e) { }
                    }
                    currentSession.activeTracks.delete(trackId);
                }

                const currentMode = getPlaybackMode();
                const { audioQueue, startAudioStream, playStreamTrack, playSoundTrack } = require('./playerService');

                if (currentMode === 'queue' && audioQueue && audioQueue.length > 0) {
                    const nextTrack = audioQueue.shift();
                    console.log(`[QUEUE] Pobrano z kolejki i uruchamiam: "${nextTrack.displayTitle || nextTrack.file}"`);

                    if (nextTrack.streamQueryOrUrl) {
                        playStreamTrack(
                            nextTrack.voiceChannel,
                            nextTrack.streamQueryOrUrl,
                            nextTrack.displayTitle,
                            nextTrack.userTag,
                            nextTrack.streamCategory,
                            nextTrack.userId,
                            nextTrack.avatarUrl
                        );
                    } else {
                        startAudioStream(currentSession, nextTrack);
                    }

                    if (currentSession.player) {
                        currentSession.player.unpause();
                    }

                    try {
                        const { updateMainPanel } = require('../ui/uiBuilders');
                        await updateMainPanel({ guild: voiceChannel.guild });
                    } catch (err) { }
                    return;
                }

                if (currentSession.activeTracks.size === 0 && typeof resetDisconnectTimer === 'function') {
                    resetDisconnectTimer(guildId);
                }
            }

            try {
                const { updateMainPanel } = require('../ui/uiBuilders');
                await updateMainPanel({ guild: voiceChannel.guild });
            } catch (err) { }
        };

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

        connection.on(VoiceConnectionStatus.Disconnected, async () => {
            console.log(`[CLIENT] Bot został rozłączony z kanału głosowego: ${guildId}`);
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
    } else if (voiceChannel && session.connection.joinConfig.channelId !== voiceChannel.id) {
        session.connection.rejoin({
            channelId: voiceChannel.id,
            selfDeaf: true
        });
    }

    return session;
}

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
            console.log(`[AUTODISCONNECT] Zatrzymano timer nieaktywności na serwerze: ${guildId}`);
        } else {
            if (session.connection && session.activeTracks.size === 0) {
                console.log(`[AUTODISCONNECT] Aktualizacja działającego timera do nowej wartości: ${minutes} min na serwerze: ${guildId}`);
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

async function handleVoiceStateChange(oldState, newState) {
    const guildId = newState.guild?.id || oldState.guild?.id;
    if (!guildId) return;
    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;
    const userTag = member.user.tag;
    const oldChannel = oldState.channel;
    const newChannel = newState.channel;

    if (!oldChannel && newChannel) {
        console.log(`[VOICESTATE] Użytkownik "${userTag}" WSZEDŁ na kanał "${newChannel.name}" (Gildia: ${newChannel.guild.name}`);
        const intros = getUserIntros();
        const userIntro = intros[member.id];
        if (userIntro && userIntro.enabled !== false) {
            playUserIntro(newChannel, userIntro.category, userIntro.fileName, member);
        } else if (userIntro && userIntro.enabled === false) {
            console.log(`[INTRO] Użytkownik ${member.user.tag} wszedł na kanał, ale jego intro jest WYŁĄCZONE (disable).`);
        }
    }
    else if (oldChannel && !newChannel)
        console.log(`[VOICESTATE] Użytkownik "${userTag}" OPUŚCIŁ kanał "${oldChannel.name}"`);
    else if (oldChannel && newChannel && oldChannel.id !== newChannel.id)
        console.log(`[VOICESTATE] Użytkownik "${userTag}" PRZESZEDŁ z kanału "${oldChannel.name}" na "${newChannel.name}"`);

    const session = guildSessions.get(guildId);
    if (!session || !session.connection) return;

    if (member.id === newState.client.user.id && !newState.channelId) {
        console.log(`[VOICESTATE] Wykryto opuszczenie kanału przez bota`);
        stopAllTracks(guildId);
        clearDisconnectTimer(guildId);
        guildSessions.delete(guildId);
        return;
    }
    const channelId = session.connection.joinConfig.channelId;
    const voiceChannel = newState.guild.channels.cache.get(channelId);
    if (!voiceChannel) return;

    const humanMembers = voiceChannel.members.filter(m => !m.user.bot);
    console.log(`[VOICESTATE] Zmiana na "${voiceChannel.name}". Liczba ludzi na kanale bota: ${humanMembers.size}`);

    if (humanMembers.size === 0) {
        if (!session.emptyChannelTimer) {
            const delay = Math.min(autoDisconnectDelayMs || 60000, 60000);
            console.log('[AUTODISCONNECT] Kanał głosowy pusty. Uruchamianie timera...');
            session.emptyChannelTimer = setTimeout(() => {
                if (session.connection) {
                    const currentChannel = newState.guild.channels.cache.get(channelId);
                    const currentHumans = currentChannel?.members.filter(m => !m.user.bot);
                    if (!currentHumans || currentHumans.size === 0) {
                        console.log(`[AUTODISCONNECT] Minął czas. Bot opuszcza pusty kanał! GuildID: ${guildId}`);
                        stopAllTracks(guildId);
                        try {
                            session.connection.destroy();
                        } catch (error) { }
                        session.connection = null;
                        guildSessions.delete(guildId);
                    } else {
                        console.log('[AUTODISCONNECT] Anulowano wyjście - ktoś wszedł na kanał.');
                    }
                }
                session.emptyChannelTimer = null;
            }, delay);
        }
    } else {
        if (session.emptyChannelTimer) {
            console.log('[AUTODISCONNECT] Użytkownik wrócił na kanał bota. Stop timer.');
            clearTimeout(session.emptyChannelTimer);
            session.emptyChannelTimer = null;
        }
    }
    const { updateMainPanel } = require('../ui/uiBuilders');
    await updateMainPanel({ guild: voiceChannel.guild }).catch(() => { });

    // if (newState.member.id === newState.client.user.id && !newState.channelId) {
    //     const joinedChannel = !oldState.channelId && newState.channelId;
    //     if (joinedChannel) {
    //         const userId = newState.member.id;
    //         const intros = getUserIntros();
    //         if (intros[userId]) {
    //             const { category, fileName } = intros[userId];
    //             const voiceChannel = newState.channel;
    //             console.log(`[INTRO] ${newState.member.user.username} wszedł na kanał "${voiceChannel.name}". Odpalam intro: ${fileName}`);
    //             const guildId = voiceChannel.guild.id;
    //             const session = getGuildSession(guildId, voiceChannel);
    //             playSoundTrack(voiceChannel, category, fileName, `Intro: ${newState.member.user.username}`);
    //         }
    //     }
    //     console.log(`[VoiceState] Wykryto opuszczenie kanału przez bota`);
    //     stopAllTracks(guildId);
    //     clearDisconnectTimer(guildId);
    //     guildSessions.delete(guildId);
    //     return;
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

// TODO: Maybe move to playerService.js?
function playUserIntro(voiceChannel, category, fileName, member) {
    const matchedCategory = typeof findCategory === 'function'
        ? (findCategory(category) || category)
        : category;
    const matchedFile = typeof findAudioFile === 'function'
        ? (findAudioFile(matchedCategory, fileName) || fileName)
        : fileName;
    const userTag = member.user.tag || member.user.username;
    const userId = member.user.id;
    console.log(`[INTRO] Odpalam intro dla ${userTag}: ${matchedCategory}/${matchedFile}`);
    playSoundTrack(
        voiceChannel,
        matchedCategory,
        matchedFile,
        `Intro: ${userTag}`,
        userId,
    );
}

module.exports = {
    guildSessions,
    getGuildSession,
    getActiveTracks,
    playUserIntro,
    clearDisconnectTimer,
    resetDisconnectTimer,
    setAutoDisconnectMinutes,
    getAutoDisconnectStatus,
    handleVoiceStateChange,
    stopAllTracks
};