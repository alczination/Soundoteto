// Commands Handler
const {
    handlePlayCommand,
    soundAdd,
    soundSetEmoji,
    soundRename,
    soundDelete,
    soundMove
} = require('./soundHandler');
const {
    categoryCreate,
    categoryRename,
    categoryDelete,
    categorySetEmoji
} = require('./categoryHandler');
const {
    buildMainDashboard,
    renderFullSoundboard,
    buildUserFavoritesMessage,
    userFavorites,
    saveFavorites,
    findCategory,
    findAudioFile,
    soundDisplayNames,
    categoryNames,
    categoryColors,
    categoryMessageRefs,
    saveConfig,
    hiddenCategories
} = require('../ui/uiBuilders');
const {
    stopAllTracks,
    playTTSTrack,
    SOUNDS_DIR
} = require('../audio/playerService');
const {
    setAutoDisconnectMinutes,
    getAutoDisconnectStatus
} = require('../audio/voiceSessionManager');
const {
    setUserIntro,
    setUserIntroStatus,
    removeUserIntro,
    getUserIntros
} = require('../config/userIntrosManager');
const {
    loadStats
} = require('../utils/statsManager');

const {
    EmbedBuilder
} = require('discord.js');
const fs = require('fs');
const path = require('path');

async function handleChatInputCommand(interaction) {
    const { commandName } = interaction;

    if (commandName === 'setup-panel') {
        await interaction.reply({
            content: 'Generowanie panela...',
            flags: 64
        });
        console.log('[CLIENT] Generowanie nowego panela');
        await renderFullSoundboard(interaction.channel);
        return;
    }
    if (commandName === 'panel') {
        const dashboard = buildMainDashboard(interaction.member);
        return interaction.reply({
            embeds: dashboard.embeds,
            components: dashboard.components,
            flags: 64
        });
    }
    if (commandName === 'tts') {
        await interaction.deferReply({ flags: 64 });
        const voice = interaction.options.getString('lektor') || 'Jacek';
        const text = interaction.options.getString('tekst');
        const voiceChannel = interaction.member?.voice?.channel;
        if (!voiceChannel) {
            return interaction.editReply({
                content: 'Musisz byc na kanale'
            });
        }
        try {
            await playTTSTrack(voiceChannel, text, voice, interaction.user.username);
            const { updateMainPanel } = require('../ui/uiBuilders');
            await updateMainPanel({ guild: interaction.guild }).catch(() => { });
            /*
            return interaction.editReply({
                content: `🗣️ **[${voice}]**: "${text}"`
            });
            */
        } catch (error) {
            console.error('[TTS] Błąd TTS:', error);
            return interaction.editReply({
                content: 'Błąd TTS',
            });
        }
    }
    if (commandName === 'stopall') {
        stopAllTracks(interaction.guildId);
        console.log('[FFMPEG] Zatrzymano odtwarzanie wszystkich dźwięków');
        await updateMainPanel();
        return interaction.reply({
            content: '🛑 **Zatrzymano wszystkie dźwięki.**',
            flags: 64
        });
    }
    if (commandName === 'disconnect') {
        const minutes = interaction.options.getInteger('czas');
        const { setAutoDisconnectMinutes, getAutoDisconnectStatus } = require('../audio/audioManager');
        if (minutes === null) {
            const status = getAutoDisconnectStatus(interaction.guildId);
            return interaction.reply({
                content: status.message,
                flags: 64
            });
        }
        setAutoDisconnectMinutes(minutes);
        if (minutes === 0) {
            console.log('[AUTODISCONNECT] Wyłączono automatyczny disconnect.');
            return interaction.reply({
                content: 'Automatyczny disconnect został **wyłączony**',
                flags: 64
            });
        } else {
            console.log('[AUTODISCONNECT] Włączono automatyczny disconnect.');
            return interaction.reply({
                content: `Włączono automatyczny disconnect po **${minutes} min** nieaktywności.`,
                flags: 64
            });
        }
    }
    if (commandName === 'favorite') {
        const subcommand = interaction.options.getSubcommand();
        const userId = interaction.user.id;
        if (!userFavorites[userId]) {
            userFavorites[userId] = [];
        }
        if (subcommand === 'list') {
            const msgData = buildUserFavoritesMessage(userId, interaction.user.username);
            return interaction.reply({
                embeds: msgData.embeds,
                components: msgData.components,
                flags: 64
            });
        }
        await interaction.deferReply({ flags: 64 });
        if (subcommand === 'add') {
            const categoryInput = interaction.options.getString('kategoria').trim();
            const soundInput = interaction.options.getString('dzwiek').trim();
            const matchedFolder = findCategory(categoryInput);
            if (!matchedFolder) {
                return interaction.editReply({
                    content: `❌ Nie znaleziono kategorii **"${categoryInput}"**.`
                });
            }
            const matchedFile = findAudioFile(matchedFolder, soundInput);
            if (!matchedFile) {
                return interaction.editReply({
                    content: `❌ Nie znaleziono dźwięku **"${soundInput}"**.`
                });
            }
            const soundKey = `${matchedFolder}/${matchedFile}`;
            if (userFavorites[userId].includes(soundKey)) {
                return interaction.editReply({
                    content: `ℹ️ Dźwięk **"${soundInput}"** już znajduje się w twoich ulubionych.`
                });
            }
            userFavorites[userId].push(soundKey);
            saveFavorites();
            return interaction.editReply({
                content: `⭐ Pomyślnie dodano **"${soundInput}"** do twoich ulubionych!`
            });
        }
        if (subcommand === 'remove') {
            const soundInput = interaction.options.getString('dzwiek').trim();
            const index = userFavorites[userId].findIndex(key => {
                const [, file] = key.split('/');
                const displayName = soundDisplayNames[key] || path.parse(file).name;
                return displayName.toLowerCase() === soundInput.toLowerCase() || file.toLowerCase() === soundInput.toLowerCase();
            });
            if (index === -1) {
                return interaction.editReply({
                    content: `❌ Dźwięk **"${soundInput}"** nie znajduje się na twojej liście ulubionych.`
                });
            }
            const removedKey = userFavorites[userId].splice(index, 1)[0];
            saveFavorites();
            return interaction.editReply({
                content: `🗑️ Usunięto **"${soundInput}"** z twojej listy ulubionych.`
            });
        }
    }
    if (commandName === 'play') {
        return await handlePlayCommand(interaction);
    }
    if (commandName === 'sound') {
        const subcommand = interaction.options.getSubcommand();
        await interaction.reply({ content: '**Teto się opierdala... proszę czekać!**', flags: 64 });
        if (subcommand === 'add') {
            return await soundAdd(interaction, {
                rawCategory: interaction.options.getString('kategoria')?.trim(),
                attachment: interaction.options.getAttachment('plik'),
                urlInput: interaction.options.getString('link_yt'),
                customNameInput: interaction.options.getString('nazwa')?.trim(),
                startTimeRaw: interaction.options.getString('start'),
                endTimeRaw: interaction.options.getString('end'),
                emojiInput: interaction.options.getString('emoji')?.trim()
            });
        }
        if (subcommand === 'emoji') {
            const categoryInput = interaction.options.getString('kategoria')?.trim();
            const soundInput = interaction.options.getString('dzwiek')?.trim();
            const emojiInput = interaction.options.getString('emoji')?.trim();
            const iconAttachment = interaction.options.getAttachment('plik_ikony');
            return await soundSetEmoji(interaction, categoryInput, soundInput, emojiInput, iconAttachment);
        }
        if (subcommand === 'stats') {
            const { loadStats } = require('../utils/statsManager');
            const stats = loadStats();
            const topSounds = Object.entries(stats.sounds || {})
                .sort(([, a], [, b]) => b - a)
                .slice(0, 15)
                .map(([key, count], i) => `${i + 1}. \`${key.split('/')[1]}\` (${key.split('/')[0]}) — **${count}** razy`)
                .join('\n') || 'Brak danych';
            const topUsers = Object.values(stats.users || {})
                .sort((a, b) => b.uses - a.uses)
                .slice(0, 5)
                .map((u, i) => `${i + 1}. **${u.tag}** - ${u.uses} użyć`)
                .join('\n') || 'Brak danych';
            const formatSeconds = (sec) => {
                const d = Math.floor(sec / (3600 * 24));
                const h = Math.floor((sec % (3600 * 24)) / 3600);
                const m = Math.floor((sec % 3600) / 60);
                return `${d}d ${h}h ${m}m`;
            };
            const embed = new EmbedBuilder()
                .setTitle('📊 Statystyki')
                .setColor(0x3498DB)
                .addFields(
                    { name: '⏱️ Całkowity czas odtwarzania', value: formatSeconds(stats.totalPlayTimeSeconds), inline: true },
                    { name: '🔊 Odtworzonych dźwięków', value: `${stats.totalSoundsPlayed} razy`, inline: true },
                    { name: '🏆 Najwięksi hałasownicy', value: topUsers },
                    { name: '🔥 Top 15 dźwięków', value: topSounds }
                ).setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }
        if (subcommand === 'rename') {
            const category = interaction.options.getString('kategoria')?.trim();
            const soundInput = interaction.options.getString('dzwiek')?.trim();
            const newName = interaction.options.getString('nowa_nazwa')?.trim();
            return await soundRename(interaction, category, soundInput, newName);
        }
        if (subcommand === 'delete') {
            const categoryInput = interaction.options.getString('kategoria')?.trim();
            const soundInput = interaction.options.getString('dzwiek')?.trim() || interaction.options.getString('plik')?.trim();
            return await soundDelete(interaction, categoryInput, soundInput);
        }
        if (subcommand === 'normalize') {
            const categoryInput = interaction.options.getString('kategoria');
            const soundInput = interaction.options.getString('dzwiek');
            if (categoryInput && soundInput) {
                const matchedFile = findAudioFile(categoryInput, soundInput);
                if (!matchedFile) {
                    return interaction.editReply({
                        content: `❌ Nie znaleziono dźwięku **"${soundInput}"** w kategorii **${categoryInput}**.`
                    });
                }
                const targetPath = path.join(SOUNDS_DIR, categoryInput, matchedFile);
                try {
                    await normalizeSingleFile(targetPath);
                    return interaction.editReply({
                        content: `✅ Pomyślnie znormalizowano dźwięk **${matchedFile}** w kategorii **${categoryInput}** do **-16 LUFS**.`
                    });
                } catch (err) {
                    return interaction.editReply({
                        content: `❌ Błąd podczas normalizacji dźwięku **${matchedFile}**: \`${err.message}\``
                    });
                }
            }
            if (categoryInput && !soundInput) {
                const targetDir = path.join(SOUNDS_DIR, categoryInput);
                if (!fs.existsSync(targetDir)) {
                    return interaction.editReply({
                        content: `❌ Kategoria/folder **"${categoryInput}"** nie istnieje.`
                    });
                }
                try {
                    const files = fs.readdirSync(targetDir)
                        .filter(f => f.endsWith('.mp3') || f.endsWith('.wav'))
                        .map(f => path.join(targetDir, f));
                    await normalizeMultipleFiles(files);
                    return interaction.editReply({
                        content: `✅ Pomyślnie znormalizowano wszystkie dźwięki (**${files.length}** szt.) w kategorii **${categoryInput}**!`
                    });
                } catch (err) {
                    return interaction.editReply({
                        content: `❌ Błąd podczas normalizacji kategorii **${categoryInput}**: \`${err.message}\``
                    });
                }
            }
            if (!categoryInput && !soundInput) {
                if (!fs.existsSync(SOUNDS_DIR)) {
                    return interaction.editReply({
                        content: '❌ Katalog `sounds/` nie istnieje.'
                    });
                }
                const allFiles = [];
                const categories = fs.readdirSync(SOUNDS_DIR, { withFileTypes: true })
                    .filter(d => d.isDirectory())
                    .map(d => d.name);
                for (const cat of categories) {
                    const catDir = path.join(SOUNDS_DIR, cat);
                    const files = fs.readdirSync(catDir)
                        .filter(f => f.endsWith('.mp3') || f.endsWith('.wav'))
                        .map(f => path.join(catDir, f));
                    allFiles.push(...files);
                }
                if (allFiles.length === 0) {
                    return interaction.editReply({
                        content: '⚠️ Biblioteka soundboardu jest pusta. Brak plików do znormalizowania.'
                    });
                }
                try {
                    await normalizeMultipleFiles(allFiles);
                    return interaction.editReply({
                        content: `✅ Pomyślnie znormalizowano **całą bibliotekę**! Przeproprocesowano **${allFiles.length}** plików audio we wszystkich kategoriach.`
                    });
                } catch (err) {
                    return interaction.editReply({
                        content: `❌ Błąd podczas normalizacji biblioteki: \`${err.message}\``
                    });
                }
            }
        }
        if (subcommand === 'move') {
            const oldCatInput = interaction.options.getString('kategoria')?.trim();
            const soundInput = interaction.options.getString('dzwiek')?.trim();
            const newCatInput = interaction.options.getString('nowa_kategoria')?.trim();
            return await soundMove(interaction, oldCatInput, soundInput, newCatInput);
        }
        await updateMainPanel(interaction.member);
        return interaction.editReply({
            content: 'Operacja zakończona.'
        });
    }
    if (commandName === 'category') {
        const subcommand = interaction.options.getSubcommand();
        await interaction.reply({ content: '**Teto się opierdala... proszę czekać!**', flags: 64 });
        const category = interaction.options.getString('kategoria')?.trim();
        const matchedFolder = findCategory(categoryInput);
        if (!matchedFolder) {
            return interaction.editReply({ content: `❌ Nie znaleziono kategorii **"${categoryInput}"**.` });
        }

        if (subcommand === 'create') {
            const rawCategoryName = interaction.options.getString('nazwa')?.trim();
            return await categoryCreate(interaction, rawCategoryName);
        }
        if (subcommand === 'rename') {
            const categoryInput = interaction.options.getString('kategoria')?.trim();
            const newDisplayName = interaction.options.getString('nowa_nazwa')?.trim();
            return await categoryRename(interaction, categoryInput, newDisplayName);
        }
        // TODO: Unterordnen in eine Funktion
        if (subcommand === 'hide') {
            const categoryInput = interaction.options.getString('kategoria')?.trim();
            if (!categoryInput) {
                return interaction.editReply({
                    content: '❌ Nie podano nazwy kategorii.'
                });
            }
            const matchedFolder = findCategory(categoryInput);
            if (!matchedFolder) {
                return interaction.editReply({
                    content: `❌ Nie znaleziono kategorii **"${categoryInput}"**.`
                });
            }
            const displayName = categoryNames[matchedFolder] || matchedFolder;
            let isHiddenNow = false;
            if (hiddenCategories.has(matchedFolder)) {
                hiddenCategories.delete(matchedFolder);
                isHiddenNow = false;
            } else {
                hiddenCategories.add(matchedFolder);
                isHiddenNow = true;
            }
            if (typeof saveConfig === 'function') saveConfig();
            await renderFullSoundboard(interaction.channel);
            if (isHiddenNow) {
                return interaction.editReply({
                    content: `Kategoria **"${displayName}"** została **ukryta** na kanale.`
                });
            } else {
                return interaction.editReply({
                    content: `👁️ Kategoria **"${displayName}"** jest teraz ponownie **widoczna** na kanale.`
                });
            }
        }
        if (subcommand === 'delete') {
            const categoryInput = interaction.options.getString('kategoria')?.trim();
            return await categoryDelete(interaction, categoryInput);
        }
        if (subcommand === 'build') {
            const categoryInput = interaction.options.getString('kategoria')?.trim();
            const categoryFolder = typeof findCategory === 'function'
                ? findCategory(categoryInput)
                : categoryInput;
            const catPath = path.join(SOUNDS_DIR, categoryFolder || '');
            if (!categoryFolder || !fs.existsSync(catPath)) {
                return interaction.editReply({
                    content: `❌ Kategoria **"${categoryInput}"** nie istnieje na serwerze!`
                });
            }
            const categoryData = buildCategoryMessage(categoryFolder);
            const sentMessage = await interaction.channel.send(categoryData);
            categoryMessageRefs.set(categoryFolder, sentMessage);
            if (typeof saveConfig === 'function') saveConfig();
            const displayName = categoryNames[categoryFolder] || categoryFolder;
            return interaction.editReply({
                content: `✅ Pomyślnie zbudowano kategorię **${displayName}** na tym kanale!`
            });
        }
        if (subcommand === 'emoji') {
            const categoryInput = interaction.options.getString('kategoria');
            const emojiInput = interaction.options.getString('emoji');
            return await categorySetEmoji(interaction, categoryInput, emojiInput);
        }
        // TODO: Unterordnen in eine Funktion!
        if (subcommand === 'color') {
            const colorValue = interaction.options.getString('kolor');
            const colorMap = {
                'Primary': ButtonStyle.Primary,
                'Secondary': ButtonStyle.Secondary,
                'Success': ButtonStyle.Success,
                'Danger': ButtonStyle.Danger
            };
            categoryColors[category] = colorMap[colorValue] || ButtonStyle.Primary;
            if (typeof saveConfig === 'function') saveConfig();
            await updateCategoryMessage(interaction.channel, category);
            return interaction.editReply({
                content: `🎨 Zmieniono kolor przycisków dla kategorii **${category}** na: **${colorValue}**.`
            });
        }
        await updateMainPanel(interaction.channel);
        return interaction.editReply({
            content: 'Pomyślna aktualizacja!'
        });
    }
    if (commandName === 'intro') {
        await interaction.deferReply({ flags: 64 });
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'set') {
            const categoryInput = interaction.options.getString('kategoria');
            const soundInput = interaction.options.getString('dzwiek');
            setUserIntro(interaction.user.id, categoryInput, soundInput);
            return interaction.editReply({
                content: `🔊 Ustawiono Twój dźwięk powitalny na: **${soundInput}** (kategoria: \`${categoryInput}\`)!`
            });
        }
        if (subcommand === 'disable') {
            const updated = setUserIntroStatus(interaction.user.id, false);
            if (!updated)
                return interaction.editReply({ content: '❌ Nie masz jeszcze przypisanego żadnego dźwięku powitalnego. Użyj najpierw `/intro set`.' });
            return interaction.editReply({ content: '🔕 Twój dźwięk powitalny został **wyłączony** (dźwięk pozostał w pamięci).' });
        }
        if (subcommand === 'enable') {
            const updated = setUserIntroStatus(interaction.user.id, true);
            if (!updated)
                return interaction.editReply({ content: '❌ Nie masz przypisanego żadnego dźwięku powitalnego. Użyj `/intro set`.' });
            const intros = getUserIntros();
            const userIntro = intros[interaction.user.id];
            return interaction.editReply({
                content: `🔔 Twój dźwięk powitalny został **włączony**! (Bieżący dźwięk: **${userIntro.fileName}**)`
            });
        }
        if (subcommand === 'remove') {
            const removed = removeUserIntro(interaction.user.id);
            if (removed) {
                return interaction.editReply({
                    content: '✅ Usunięto Twój dźwięk powitalny.'
                });
            } else {
                return interaction.editReply({
                    content: 'ℹ️ Nie miałeś ustawionego żadnego dźwięku powitalnego.'
                });
            }
        }
    }
}

module.exports = { handleChatInputCommand };
