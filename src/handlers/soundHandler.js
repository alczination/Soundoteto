// Functions for /sound commands
const fs = require('fs');
const path = require('path');
const {
    SOUNDS_DIR,
    playStreamTrack 
} = require('../audio/playerService');
const {
    categoryNames,
    soundDisplayNames,
    buttonEmojis,
    normalizedFiles,
    saveConfig,
    renderFullSoundboard,
    updateMainPanel,
    updateCategoryMessage
} = require('../ui/uiBuilders');
const {
    findAudioFile,
    clearFileName,
    clearFolderName,
    parseTimestamp,
    downloadFile,
    downloadYouTubeAudio,
    getYoutubeTitle,
    trimAudioFile,
    normalizeSingleFile
} = require('../utils/audioUtils');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getGuildSession } = require('../audio/voiceSessionManager');
const { getDetails } = require('spotify-url-info')(fetch);
const {
    findCategory,
    categoryCreate,
    categoryRename,
    categoryDelete,
    categorySetEmoji
} = require('./categoryHandler');

async function soundAdd(interaction, options) {
    const {
        rawCategory,
        attachment = null,
        urlInput = null,
        customNameInput = null,
        startTimeRaw = null,
        endTimeRaw = null,
        emojiInput = null
    } = options;

    if (!attachment && !urlInput) {
        return interaction.editReply({
            content: '❌ Musisz załączyć plik audio (`.mp3`/`.wav`) LUB podać odnośnik internetowy (`link_yt`/`link`)!'
        });
    }
    const startTime = parseTimestamp(startTimeRaw);
    const endTime = parseTimestamp(endTimeRaw);

    if (startTimeRaw && startTime === null) {
        return interaction.editReply({
            content: '❌ Niepoprawny format opcji `poczatek`! Użyj formatu np. `0:02`, `1:15` lub podaj same sekundy.'
        });
    }

    if (endTimeRaw && endTime === null) {
        return interaction.editReply({
            content: '❌ Niepoprawny format opcji `koniec`! Użyj formatu np. `0:05`, `1:30` lub podaj same sekundy.'
        });
    }

    if (startTime !== null && endTime !== null && Number(startTime) >= Number(endTime)) {
        return interaction.editReply({
            content: '❌ Czas rozpoczęcia (`poczatek`) musi być mniejszy niż czas zakończenia (`koniec`)!'
        });
    }

    let matchedFolder = findCategory(rawCategory);
    if (!matchedFolder) {
        const cleanInput = clearFolderName(rawCategory);
        if (!cleanInput) {
            return interaction.editReply({
                content: '❌ Podano nieprawidłową nazwę kategorii!'
            });
        }
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`cat_confirm_create:${cleanInput}:${encodeURIComponent(rawCategory)}`)
                .setLabel(`➕ Utwórz kategorię "${rawCategory}"`)
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`cat_fallback_inne:${cleanInput}`)
                .setLabel('📁 Przypisz do kategorii "Inne"')
                .setStyle(ButtonStyle.Secondary)
        );
        return interaction.editReply({
            content: `❓ Kategoria **"${rawCategory}"** nie istnieje. Czy chcesz ją utworzyć, czy przypisać dźwięk do kategorii **Inne**?`,
            components: [row]
        });
    }

    const targetDir = path.join(SOUNDS_DIR, matchedFolder);
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    const originalFileName = attachment?.name || null;
    const extension = originalFileName ? path.extname(originalFileName).toLowerCase() : '.mp3';
    if (attachment && extension !== '.mp3' && extension !== '.wav') {
        return interaction.editReply({
            content: '❌ Niepoprawny format! Akceptowane są wyłącznie pliki z rozszerzeniem `.mp3` lub `.wav`.'
        });
    }

    const baseName = originalFileName || (customNameInput ? `${customNameInput}.mp3` : `audio_${Date.now()}.mp3`);
    const fileName = clearFileName(customNameInput, baseName, extension);
    const targetPath = path.join(targetDir, fileName);
    const tempPathRaw = path.join(targetDir, `raw_${Date.now()}_${fileName}`);
    const tempPathTrimmed = path.join(targetDir, `temp_${Date.now()}_${fileName}`);
    
    try {
        if (attachment) {
            await downloadFile(attachment.url, tempPathRaw);
        } else if (urlInput) {
            await downloadYouTubeAudio(urlInput, tempPathRaw);
        }
        if (startTime !== null || endTime !== null) {
            await trimAudioFile(tempPathRaw, tempPathTrimmed, startTime, endTime);
            if (fs.existsSync(tempPathRaw)) fs.unlinkSync(tempPathRaw);
        } else {
            fs.renameSync(tempPathRaw, tempPathTrimmed);
        }
        await normalizeSingleFile(tempPathTrimmed);
        fs.renameSync(tempPathTrimmed, targetPath);
        let ytTitle = null;
        if (!customNameInput && urlInput) {
            ytTitle = await getYoutubeTitle(urlInput);
        }
        const fallbackDisplayName = attachment?.name ? path.parse(attachment.name).name : (ytTitle || path.parse(fileName).name);
        const effectiveDisplayName = (customNameInput && customNameInput.trim()) ? customNameInput.trim() : fallbackDisplayName;
        const soundKey = `${matchedFolder}/${fileName}`;
        if (typeof soundDisplayNames !== 'undefined') {
            soundDisplayNames[soundKey] = effectiveDisplayName;
        }
        if (emojiInput) {
            buttonEmojis[soundKey] = emojiInput.trim();
        }
        if (typeof normalizedFiles !== 'undefined') {
            normalizedFiles.add(soundKey);
        }
        if (typeof saveConfig === 'function') saveConfig();
        let trimInfo = '';
        if (startTime !== null && endTime !== null) {
            trimInfo = ` ✂️ *(Przycięto: ${startTimeRaw} ➔ ${endTimeRaw})*`;
        } else if (startTime !== null) {
            trimInfo = ` ✂️ *(Przycięto: od ${startTimeRaw})*`;
        } else if (endTime !== null) {
            trimInfo = ` ✂️ *(Przycięto: do ${endTimeRaw})*`;
        }
        // await renderFullSoundboard(interaction.channel);
        await updateCategoryMessage(interaction.channel, matchedFolder);
        console.log(`[SOUND HANDLER] Pomyślnie dodano dźwięk ${fileName} w kategorii ${matchedFolder}`);
        return interaction.editReply({
            content: `✅ Pomyślnie dodano dźwięk **${effectiveDisplayName}** do kategorii **${categoryNames[matchedFolder] || matchedFolder}**!${trimInfo}${emojiInput ? ` (Emoji: ${emojiInput})` : ''}`
        });
    } catch (error) {
        console.error('[SOUND HANDLER] ERROR: ', error);
        if (fs.existsSync(tempPathRaw)) fs.unlinkSync(tempPathRaw);
        if (fs.existsSync(tempPathTrimmed)) fs.unlinkSync(tempPathTrimmed);
        if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
        return interaction.editReply({
            content: `❌ **Odrzucono!** Wystąpił błąd podczas pobierania, przycinania lub normalizacji: \`${error.message}\``
        });
    }
}

async function soundRename(interaction, categoryInput, soundInput, newDisplayName) {
    if (!categoryInput || !soundInput || !newDisplayName) {
        return interaction.editReply({
            content: '❌ Wprowadzono niekompletne dane! Wymagana kategoria, dźwięk oraz nowa nazwa.'
        });
    }
    const matchedFolder = findCategory(categoryInput);
    if (!matchedFolder) {
        return interaction.editReply({
            content: `❌ Nie znaleziono kategorii **"${categoryInput}"**.`
        });
    }
    const matchedFile = findAudioFile(matchedFolder, soundInput);
    if (!matchedFile) {
        return interaction.editReply({
            content: `❌ Nie znaleziono dźwięku **"${soundInput}"** w kategorii **${categoryNames[matchedFolder] || matchedFolder}**.`
        });
    }
    const soundKey = `${matchedFolder}/${matchedFile}`;
    if (typeof soundDisplayNames !== 'undefined') {
        soundDisplayNames[soundKey] = newDisplayName.trim();
    }
    if (typeof saveConfig === 'function') saveConfig();
    await updateCategoryMessage(interaction.channel, matchedFolder);
    console.log(`[SOUND HANDLER] Zmieniono nazwę wyświetlaną dla ${soundKey} na "${newDisplayName.trim()}"`);
    return interaction.editReply({
        content: `✅ Pomyślnie zmieniono wyświetlaną nazwę dźwięku **${matchedFile}** w kategorii **${categoryInput}** na: **"${newDisplayName.trim()}"**!`
    });
}

async function soundDelete(interaction, categoryInput, soundInput) {
    if (!categoryInput || !soundInput) {
        return interaction.editReply({
            content: '❌ Nie podano nazwy dźwięku do usunięcia.',
            flags: 64
        });
    }
    const matchedFolder = findCategory(categoryInput);
    if (!matchedFolder) {
        return interaction.editReply({
            content: `❌ Nie znaleziono kategorii **"${categoryInput}"**.`
        });
    }
    const matchedFile = findAudioFile(matchedFolder, soundInput);
    if (!matchedFile) {
        return interaction.editReply({
            content: `❌ Nie znaleziono dźwięku **"${soundInput}"** w kategorii **${matchedFolder}**.`,
            flags: 64
        });
    }
    const filePath = path.join(SOUNDS_DIR, matchedFolder, matchedFile);
    try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        const soundKey = `${matchedFolder}/${matchedFile}`;
        delete buttonEmojis[soundKey];
        delete soundDisplayNames[soundKey];
        normalizedFiles.delete(soundKey);
        if (typeof saveConfig === 'function') saveConfig();
        await updateCategoryMessage(interaction.channel, matchedFolder);
        console.log(`[SOUND HANDLER] Usuwanie udane dla ${soundKey}`);
        return interaction.editReply({
            content: `🗑️ Pomyślnie usunięto dźwięk **"${soundInput}"** (\`${matchedFile}\`) z kategorii **${categoryNames[matchedFolder] || matchedFolder}**!`,
            flags: 64
        });
    } catch (error) {
        console.error('[SOUND HANDLER] Błąd podczas usuwania pliku:', error);
        return interaction.editReply({
            content: `❌ Wystąpił błąd podczas usuwania pliku z dysku: ${error.message}`,
            flags: 64
        });
    }
}

async function soundSetEmoji(interaction, categoryInput, soundInput, emojiInput, iconAttachment = null) {
    if (!categoryInput || !soundInput) {
        return interaction.editReply({
            content: '❌ Wprowadzono niekompletne dane! Wymagana kategoria albo/i dźwięk.'
        });
    }
    const matchedFolder = findCategory(categoryInput);
    if (!matchedFolder) {
        return interaction.editReply({
            content: `❌ Nie znaleziono kategorii **"${categoryInput}"**.`
        });
    }
    const matchedFile = findAudioFile(matchedFolder, soundInput);
    if (!matchedFile) {
        return interaction.editReply({
            content: `❌ Nie znaleziono dźwięku **"${soundInput}"** w kategorii **${categoryNames[matchedFolder] || matchedFolder}**.`,
            flags: 64
        });
    }
    const soundKey = `${matchedFolder}/${matchedFile}`;
    const baseName = path.parse(matchedFile).name;
    try {
        if (iconAttachment) {
            const ext = path.extname(iconAttachment.name).toLowerCase();
            const validExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.ico'];
            if (!validExtensions.includes(ext)) {
                return interaction.editReply({
                    content: '❌ Niepoprawny format pliku ikony! Dozwolone formaty: `.png`, `.jpg`, `.jpeg`, `.gif`, `.ico`.'
                });
            }
            const baseIconDir = path.join(__dirname, '../../ico');
            if (!fs.existsSync(baseIconDir)) {
                fs.mkdirSync(baseIconDir, { recursive: true });
            }
            const targetIconPath = path.join(baseIconDir, `${baseName}${ext}`);
            await downloadFile(iconAttachment.url, targetIconPath);
            if (!fs.existsSync(targetIconPath)) {
                return interaction.editReply({
                    content: `❌ Nie udało się zapisać pliku ikony na serwerze (\`${baseName}${ext}\`).`
                });
            }
            const safeEmojiName = `ico_${matchedFolder}_${baseName}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 32);
            let existingEmoji = interaction.guild.emojis.cache.find(e => e.name === safeEmojiName);
            if (!existingEmoji) {
                console.log(`[SOUND HANDLER] Wgrywanie ikony na serwer z pliku: ${baseName}${ext}`);
                existingEmoji = await interaction.guild.emojis.create({
                    attachment: targetIconPath,
                    name: safeEmojiName
                });
            }
            buttonEmojis[soundKey] = `<:${existingEmoji.name}:${existingEmoji.id}>`;
            if (typeof saveConfig === 'function') saveConfig();
            await updateCategoryMessage(interaction.channel, matchedFolder);
            return interaction.editReply({
                content: `✅ Zapisano plik ikony **${baseName}${ext}** w katalogu \`ico/\` i przypisano custom emoji do dźwięku **"${soundInput}"**!`
            });
        }
        if (emojiInput) {
            buttonEmojis[soundKey] = emojiInput;
            if (typeof saveConfig === 'function') saveConfig();
            await updateCategoryMessage(interaction.channel, matchedFolder);
            return interaction.editReply({
                content: `✅ Ustawiono emoji **${emojiInput}** dla przycisku **"${soundInput}"** w kategorii **${categoryNames[matchedFolder] || matchedFolder}**.`
            });
        }
        delete buttonEmojis[soundKey];
        if (typeof saveConfig === 'function') saveConfig();
        await updateCategoryMessage(interaction.channel, matchedFolder);
        return interaction.editReply({
            content: `🧹 Usunięto emoji z przycisku **"${soundInput}"** w kategorii **${categoryNames[matchedFolder] || matchedFolder}**.`
        });
    } catch (error) {
        console.error('[SOUND HANDLER] Error:', error);
        return interaction.editReply({
            content: `❌ Wystąpił błąd podczas ustawiania ikony/emoji: \`${error.message}\``
        });
    }
}

async function soundMove(interaction, oldCatInput, soundInput, newCatInput) {
    if (!oldCatInput || !soundInput || !newCatInput) {
        return interaction.editReply({
            content: '❌ Wprowadzono niekompletne dane! Wymagana jest obecna kategoria, dźwięk oraz nowa kategoria.'
        });
    }
    const sourceFolder = findCategory(oldCatInput);
    if (!sourceFolder) {
        return interaction.editReply({
            content: `❌ Nie znaleziono kategorii **"${oldCatInput}"**.`
        });
    }
    const targetFolder = findCategory(newCatInput);
    if (!targetFolder) {
        return interaction.editReply({
            content: `❌ Nie znaleziono kategorii docelowej **"${newCatInput}"**.`
        });
    }
    if (sourceFolder === targetFolder) {
        return interaction.editReply({
            content: `⚠️ Dźwięk znajduje się już w kategorii **${categoryNames[targetFolder] || targetFolder}**.`
        });
    }
    const matchedFile = findAudioFile(sourceFolder, soundInput);
    if (!matchedFile) {
        return interaction.editReply({
            content: `❌ Nie znaleziono dźwięku **"${soundInput}"** w kategorii **${categoryNames[sourceFolder] || sourceFolder}**.`
        });
    }
    const oldFilePath = path.join(SOUNDS_DIR, sourceFolder, matchedFile);
    const newFilePath = path.join(SOUNDS_DIR, targetFolder, matchedFile);
    try {
        if (fs.existsSync(oldFilePath)) {
            fs.renameSync(oldFilePath, newFilePath);
        } else {
            return interaction.editReply({
                content: `❌ Plik źródłowy nie istnieje na dysku!`
            });
        }
        const oldSoundKey = `${sourceFolder}/${matchedFile}`;
        const newSoundKey = `${targetFolder}/${matchedFile}`;
        if (typeof soundDisplayNames !== 'undefined') {
            const currentName = soundDisplayNames[oldSoundKey] || path.parse(matchedFile).name;
            soundDisplayNames[newSoundKey] = currentName;
            delete soundDisplayNames[oldSoundKey];
        }
        if (typeof buttonEmojis !== 'undefined' && buttonEmojis[oldSoundKey]) {
            buttonEmojis[newSoundKey] = buttonEmojis[oldSoundKey];
            delete buttonEmojis[oldSoundKey];
        }
        if (typeof normalizedFiles !== 'undefined') {
            if (normalizedFiles.has(oldSoundKey)) {
                normalizedFiles.delete(oldSoundKey);
                normalizedFiles.add(newSoundKey);
            }
        }
        if (typeof saveConfig === 'function') saveConfig();
        await updateCategoryMessage(interaction.channel, sourceFolder);
        await updateCategoryMessage(interaction.channel, targetFolder);
        const currentDisplayName = soundDisplayNames[newSoundKey] || matchedFile;
        console.log(`[Sound-Move] Przeniesiono ${oldSoundKey} => ${newSoundKey}`);
        return interaction.editReply({
            content: `🚚 Pomyślnie przeniesiono dźwięk **"${currentDisplayName}"** z **${categoryNames[sourceFolder] || sourceFolder}** do **${categoryNames[targetFolder] || targetFolder}**!`
        });
    } catch (error) {
        console.error('[SOUND HANDLER] ERROR:', error);
        return interaction.editReply({
            content: `❌ Wystąpił błąd podczas przenoszenia pliku: \`${error.message}\``
        });
    }
}

async function handlePlayCommand(interaction) {
    const userTag = interaction.user.username;
    const query = interaction.options.getString('query');
    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) {
        return interaction.reply({
            content: 'Eeee nie dla psa kiełbasa... musisz wbić na kanał!', flags: 64
        });
    }
    await interaction.deferReply({ flags: 64 });
    let streamTarget = query;
    let displayTitle = query;
    let streamCategory = 'YouTube';
    try {
        if (query.includes('spotify.com')) {
            streamCategory = 'Spotify';
            displayTitle = 'Wyszukiwanie utworu ze Spotify...';
            streamTarget = `ytsearch1:${query}`;
            getDetails(query).then(details => {
                const trackName = details.preview?.title || details.tracks?.[0]?.name;
                const artistName = details.preview?.artist || details.tracks?.[0]?.artists?.[0]?.name;
                if (trackName) {
                    const realTitle = artistName ? `${artistName} - ${trackName}` : trackName;
                    const session = getGuildSession(interaction.guild.id, voiceChannel);
                    if (session && session.activeTracks.has(trackId)) {
                        const track = session.activeTracks.get(trackId);
                        track.file = realTitle;
                        const { updateMainPanel } = require('../ui/uiBuilders');
                        updateMainPanel({ guild: interaction.guild });
                    }
                }
            }).catch(() => console.error('[SOUND HANDLER]:', err));
        }
        else if (query.includes('soundcloud.com')) {
            streamCategory = 'SoundCloud';
            streamTarget = query;
            displayTitle = 'Utwór z SoundCloud';
        } else if (query.includes('youtube.com') || query.includes('youtu.be')) {
            streamCategory = 'YouTube';
            streamTarget = query;
            displayTitle = 'Ładowanie tytułu...';
        }
        else {
            streamCategory = 'YouTube';
            const cleanSearch = query.replace(/"/g, '');
            streamTarget = `ytsearch1:${query}`;
            displayTitle = query;
        }
        const trackId = playStreamTrack(voiceChannel, streamTarget, displayTitle, userTag, streamCategory);
        const {updateMainPanel} = require('../ui/uiBuilders');
        await updateMainPanel({ guild: interaction.guild });
        await interaction.editReply({ content: `▶️ Odtwarzanie: **${displayTitle}**`})
        if (query.includes('youtube.com') || query.includes('youtu.be') || query.includes('soundcloud.com')) {
            getYoutubeTitle(query).then(async (realTitle) => {
                if (realTitle) {
                    const session = getGuildSession(interaction.guild.id, voiceChannel);
                    if (session && session.activeTracks.has(trackId)) {
                        const track = session.activeTracks.get(trackId);
                        track.file = realTitle;
                        await updateMainPanel({ guild: interaction.guild });
                    }
                }
            }).catch(error => console.error('[Background Title Fetch Error]:', error));
        }
    } catch (error) {
        console.error('[PLAY ERROR]:', error);
        return interaction.editReply({ content: `❌ Wystąpił błąd podczas uruchamiania strumienia: \`${error.message}\`` });
    }
}

module.exports = {
    soundAdd,
    soundRename,
    soundDelete,
    soundSetEmoji,
    handlePlayCommand
};