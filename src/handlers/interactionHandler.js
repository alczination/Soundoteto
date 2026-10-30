// Interaction-Handler (Commands and Buttons)
const fs = require('fs');
const path = require('path');
const https = require('https');
const { exec, spawn } = require('child_process');
const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const {
    playSoundTrack,
    stopSingleTrack,
    stopAllTracks,
    SOUNDS_DIR,
    getAutoDisconnectStatus
} = require('../audio/audioManager');
const {
    buildMainDashboard,
    updateMainPanel,
    renderFullSoundboard,
    categoryNames,
    categoryColors,
    normalizedFiles,
    categoryEmojis,
    buttonEmojis,
    hiddenCategories,
    saveConfig
} = require('../ui/uiBuilders');
const { crypto_pwhash_argon2i_STRPREFIX } = require('libsodium-wrappers');
const { start } = require('repl');
const { match } = require('assert');

function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        https.get(url, (response) => {
            if (response.statusCode !== 200) return reject(new Error(`Błąd pobierania pliku. Kod HTTP: ${response.statusCode}`));
            response.pipe(file);
            file.on('finish', () => {
                file.close(resolve);
            });
        }).on('error', (err) => {
            fs.unlink(destPath, () => { });
            reject(err);
        });
    });
}

function downloadYouTubeAudio(url, outputPath) {
    return new Promise((resolve, reject) => {
        const env = {
            ...process.env,
            PATH: `${process.env.PATH}:/usr/bin:/usr/local/bin:/root/.local/bin:/home/discord_soundboard/.local/bin`
        };
        const cookiesPath = path.join(__dirname, '../../cookies.txt');
        const cookiesFlag = fs.existsSync(cookiesPath) ? `--cookies "${cookiesPath}"` : '';
        const command = `yt-dlp --js-runtimes node ${cookiesFlag} -x --audio-format mp3 --audio-quality 0 -o "${outputPath}" "${url}"`;
        exec(command, { env }, (error, stdout, stderr) => {
            if (error) {
                console.error('[YouTube Download Error]:', stderr || error.message);
                return reject(new Error('Nie udało się pobrać dźwięku z YouTube. Upewnij się, że link jest poprawny.'));
            }
            resolve(true);
        });
    });
}

async function normalizeSingleFile(filePath) {
    const relativePath = path.relative(SOUNDS_DIR, filePath);
    const soundKey = relativePath.replace(/\\/g, '/');
    if (typeof normalizedFiles !== 'undefined' && normalizedFiles.has(soundKey)) {
        console.log(`[Normalizacja] Plik jest już znormalizowany: ${soundKey}`);
        return false;
    }
    return new Promise((resolve, reject) => {
        const ext = path.extname(filePath).replace('.', '');
        const command = `ffmpeg-normalize "${filePath}" -ext ${ext} -c:a libmp3lame -b:a 192k -nt ebu --target-level=-16 -f`;
        const env = {
            ...process.env,
            PATH: `${process.env.PATH}:/root/.local/bin:/home/discord_soundboard/.local/bin:/usr/local/bin`
        };
        exec(command, { env }, (error, stdout, stderr) => {
            if (error) {
                console.error(`[Normalizacja] Błąd dla ${filePath}:`, stderr || error.message);
                return reject(new Error(stderr || error.message));
            }
            normalizedFiles.add(soundKey);
            saveConfig();
            console.log(`[Normalizacja] Pomyślnie znormalizowano plik: ${filePath}`);
            resolve(true);
        });
    });
}

function normalizeMultipleFiles(filePath) {
    return new Promise((resolve, reject) => {
        if (!filePath || filePath.length === 0) return resolve(0);
        const env = {
            ...process.env,
            PATH: `${process.env.PATH}:/usr/bin:/usr/local/bin:/root/.local/bin:/home/discord_soundboard/.local/bin`
        };
        const escapedPaths = filePath.map(p => `"${p}"`).join(' ');
        const command = `ffmpeg-normalize ${escapedPaths} -ext mp3 -c:a libmp3lame -b:a 192k -nt ebu -t -16 -f`;
        exec(command, { env }, (error, stdout, stderr) => {
            if (error) {
                console.error('[Normalizacja ERROR]:', stderr || error.message);
                return reject(new Error(stderr || error.message));
            }
            resolve(filePath.length);
        });
    });
}

function findAudioFile(category, inputName) {
    if (!category || !inputName) return null;
    const targetDir = path.join(SOUNDS_DIR, category);
    if (!fs.existsSync(targetDir)) return null;
    const files = fs.readdirSync(targetDir).filter(f => f.endsWith('.mp3') || f.endsWith('.wav'));
    const search = inputName.trim().toLowerCase();
    return files.find(file => {
        const soundKey = `${category}/${file}`;
        const displayName = typeof soundDisplayNames !== 'undefined' ? soundDisplayNames[soundKey] : null;
        const fileNameWithoutExt = path.parse(file).name;
        return (displayName && displayName.toLowerCase() === search) ||
            fileNameWithoutExt.toLowerCase() === search ||
            file.toLowerCase() === search;
    }) || null;
}

function clearFolderName(rawName) {
    return rawName
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '');
}

function clearFileName(customNameInput, attachmentName, extension) {
    if (customNameInput && customNameInput.trim()) {
        const safeName = customNameInput.trim().replace(/[\\/:*?"<>|]/g, '');
        return `${safeName}${extension}`;
    }
    return attachmentName;
}

function parseTimestamp(input) {
    if (!input) return null;
    const cleanStr = String(input).trim();
    if (!isNaN(cleanStr)) {
        return cleanStr;
    }
    const parts = cleanStr.split(':');
    if (parts.length === 2) {
        const minutes = parseInt(parts[0], 10);
        const seconds = parseFloat(parts[1]);
        if (!isNaN(minutes) && !isNaN(seconds)) {
            return String(minutes * 60 + seconds);
        }
    } else if (parts.length === 3) {
        const hours = parseInt(parts[0], 10);
        const minutes = parseInt(parts[1], 10);
        const seconds = parseFloat(parts[2]);
        if (!isNaN(hours) && !isNaN(minutes) && !isNaN(seconds)) {
            return String(hours * 3600 + minutes * 60 + seconds);
        }
    }
    return null;
}

function trimAudioFile(inputPath, outputPath, startTime, endTime) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(inputPath))
            return reject(new Error(`Plik wejściowy do przycięcia nie istnieje pod ścieżką: ${inputPath}`));
        const args = ['-y', '-loglevel', 'error', '-i', inputPath];
        if (startTime !== null && startTime !== undefined && String(startTime).trim() !== '') args.push('-ss', String(startTime));
        if (endTime !== null && endTime !== undefined && String(endTime).trim() !== '') args.push('-to', String(endTime));
        args.push(
            '-vn', '-sn', '-dn',
            '-acodec', 'libmp3lame',
            '-b:a', '192k',
            outputPath
        );
        const ffmpegProcess = spawn('ffmpeg', args);
        let stderrData = '';
        if (ffmpegProcess.stderr) {
            ffmpegProcess.stderr.on('data', (chunk) => {
                stderrData += chunk.toString();
            });
        }
        ffmpegProcess.on('close', (code) => {
            if (code === 0) {
                resolve(true);
            } else {
                console.error(`[FFmpeg Trim Error Output]: ${stderrData}`);
                reject(new Error(`FFmpeg zakończył działanie z kodem błędu ${code}: ${stderrData || 'Brak treści błędu'}`));
            }
        });
        ffmpegProcess.on('error', (err) => reject(err));
    });
}

async function handleInteraction(interaction) {

    if (interaction.isAutocomplete()) {
        const focusedOption = interaction.options.getFocused(true);
        if (focusedOption.name === 'kategoria') {
            try {
                let categories = fs.existsSync(SOUNDS_DIR)
                    ? fs.readdirSync(SOUNDS_DIR, { withFileTypes: true })
                        .filter(d => d.isDirectory())
                        .map(d => d.name)
                    : [];
                const focusedValue = focusedOption.value.toLowerCase();
                const filtered = categories.filter(cat => {
                    const displayName = (categoryNames[cat] || cat).toLowerCase();
                    return cat.toLowerCase().includes(focusedValue) || displayName.includes(focusedValue);
                });
                await interaction.respond(
                    filtered.slice(0, 25).map(cat => ({
                        name: categoryNames[cat] ? `${categoryNames[cat]} (${cat})` : cat,
                        value: cat
                    }))
                );
            } catch (error) {
                console.error('Błąd podczas generowania podpowiedzi autocomplete:', error);
            }
        }

        if (focusedOption.name === 'dzwiek' || focusedOption.name === 'plik') {
            const category = interaction.options.getString('kategoria');
            if (!category) return interaction.respond([]);
            const targetDir = path.join(SOUNDS_DIR, category);
            if (!fs.existsSync(targetDir)) return interaction.respond([]);
            const files = fs.readdirSync(targetDir).filter(f => f.endsWith('.mp3') || f.endsWith('.wav'));
            const focusedValue = focusedOption.value.toLowerCase();
            const suggestions = files.map(file => {
                const soundKey = `${category}/${file}`;
                const displayName = typeof soundDisplayNames !== 'undefined' ? soundDisplayNames[soundKey] : null;
                const nameToShow = displayName ? `${displayName} (${file})` : file;
                const matchValue = displayName ? displayName : file;
                return { nameToShow, matchValue, file };
            }).filter(item =>
                item.matchValue.toLowerCase().includes(focusedValue) ||
                item.nameToShow.toLowerCase().includes(focusedValue)
            );
            return interaction.respond(
                suggestions.slice(0, 25).map(item => ({
                    name: item.nameToShow,
                    value: item.matchValue
                }))
            );
        }
        return;
    }
    // Slash-Commands
    if (interaction.isChatInputCommand()) {

        if (interaction.commandName === 'setup-panel') {
            await interaction.reply({ content: 'Generowanie panela...', flags: 64 });
            console.log('[PANEL] Generowanie nowego panela');
            await renderFullSoundboard(interaction.channel);
            return;
        }
        if (interaction.commandName === 'panel') {
            const dashboard = buildMainDashboard(interaction.member);
            return interaction.reply({
                embeds: dashboard.embeds,
                components: dashboard.components,
                flags: 64
            });
        }
        if (interaction.commandName === 'stopall') {
            stopAllTracks(interaction.guildId);
            console.log('[PLAYER] Zatrzymano odtwarzanie wszystkich dźwięków');
            await updateMainPanel();
            return interaction.reply({
                content: '🛑 **Zatrzymano wszystkie dźwięki.**',
                flags: 64
            });
        }
        if (interaction.commandName === 'disconnect') {
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
                console.log('[Autodisconnect] Wyłączono automatyczny disconnect.')
                return interaction.reply({
                    content: 'Automatyczny disconnect został **wyłączony**',
                    flags: 64
                });
            } else {
                console.log('[Autodisconnect] Włączono automatyczny disconnect.')
                return interaction.reply({
                    content: `Włączono automatyczny disconnect po **${minutes} min** nieaktywności.`,
                    flags: 64
                });
            }
        }
        if (interaction.commandName === 'sound') {
            const subcommand = interaction.options.getSubcommand();
            await interaction.deferReply({ flags: 64 });

            if (subcommand === 'add') {
                console.log('[Sound Upload] Rozpoczęcie dodawania nowego dźwięku.');
                const category = interaction.options.getString('kategoria').trim();
                const attachment = interaction.options.getAttachment('plik');
                const ytUrl = interaction.options.getString('link_yt');
                const customNameInput = interaction.options.getString('nazwa');
                const startTimeRaw = interaction.options.getString('start');
                const endTimeRaw = interaction.options.getString('end');
                const emojiInput = interaction.options.getString('emoji');
                if (!attachment && !ytUrl) {
                    console.error('[Sound Upload] Niepowodzenie - brak pliku / brak podanego linku:', error);
                    return interaction.editReply({
                        content: '❌ Musisz załączyć plik audio (`.mp3`/`.wav`) LUB podać `link_yt`!'
                    });
                }
                const startTime = parseTimestamp(startTimeRaw);
                const endTime = parseTimestamp(endTimeRaw);
                if (startTimeRaw && startTime === null) {
                    console.error('[Sound Upload] Niepowodzenie - niepoprawny format czasowy (początek):', error);
                    return interaction.editReply({
                        content: '❌ Niepoprawny format opcji `poczatek`! Użyj formatu np. `0:02`, `1:15` lub podaj same sekundy.'
                    });
                }
                if (endTimeRaw && endTime === null) {
                    console.error('[Sound Upload] Niepowodzenie - niepoprawny format czasowy (koniec):', error);
                    return interaction.editReply({
                        content: '❌ Niepoprawny format opcji `koniec`! Użyj formatu np. `0:05`, `1:30` lub podaj same sekundy.'
                    });
                }
                if (startTime !== null && endTime !== null && Number(startTime) >= Number(endTime)) {
                    console.error('[Sound Upload] Niepowodzenie - niepoprawny odstęp czasowy (czas rozpoczęcia mniejszny niż zakończenia)');
                    return interaction.editReply({
                        content: '❌ Czas rozpoczęcia (`poczatek`) musi być mniejszy niż czas zakończenia (`koniec`)!'
                    })
                }
                const originalFileName = attachment?.name || null;
                const extension = originalFileName ? path.extname(originalFileName).toLowerCase() : '.mp3';
                const baseName = originalFileName || (customNameInput ? `${customNameInput}.mp3` : `yt_sound_${Date.now()}.mp3`);

                if (attachment && extension !== '.mp3' && extension !== '.wav') {
                    console.error('[Sound Upload] Niepowodzenie - niepoprawny format pliku:', error);
                    return interaction.editReply({
                        content: '❌ Niepoprawny format! Akceptowane są wyłącznie pliki z rozszerzeniem `.mp3` lub `.wav`.',
                    });
                }
                const targetDir = path.join(SOUNDS_DIR, category);
                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                }
                const fileName = clearFileName(customNameInput, baseName, extension);
                const targetPath = path.join(targetDir, fileName);
                const tempPathRaw = path.join(targetDir, `raw_${Date.now()}_${fileName}`);
                const tempPathTrimmed = path.join(targetDir, `temp_${Date.now()}_${fileName}`);
                try {
                    if (attachment) {
                        await downloadFile(attachment.url, tempPathRaw);
                    } else if (ytUrl) {
                        await downloadYouTubeAudio(ytUrl, tempPathRaw);
                    }
                    if (startTime !== null || endTime !== null) {
                        await trimAudioFile(tempPathRaw, tempPathTrimmed, startTime, endTime);
                        if (fs.existsSync(tempPathRaw)) fs.unlinkSync(tempPathRaw);
                    } else {
                        fs.renameSync(tempPathRaw, tempPathTrimmed);
                    }
                    await normalizeSingleFile(tempPathTrimmed);
                    fs.renameSync(tempPathTrimmed, targetPath);
                    if (emojiInput) {
                        const buttonKey = `${category}/${fileName}`;
                        buttonEmojis[buttonKey] = emojiInput.trim();
                        if (typeof saveConfig === 'function') saveConfig();
                    }
                    await renderFullSoundboard(interaction.channel);
                    let trimInfo = '';
                    if (startTime !== null && endTime !== null) {
                        trimInfo = ` (Przycięto: ${startTimeRaw} ➔ ${endTimeRaw})`;
                    } else if (startTime !== null) {
                        trimInfo = ` (Przycięto: od ${startTimeRaw})`;
                    } else if (endTime !== null) {
                        trimInfo = ` (Przycięto: do ${endTimeRaw})`;
                    }
                    console.log('[Sound Upload] Pomyślny upload!');
                    return interaction.editReply({
                        content: `✅ Pomyślnie dodano dźwięk **${fileName}** do kategorii **${category}**!${emojiInput ? ` (Emoji: ${emojiInput})` : ''}`
                    });
                } catch (error) {
                    console.error('[Sound Upload] Błąd podczas zapisywania/przycinania dźwięku:', error);
                    if (fs.existsSync(tempPathRaw)) fs.unlinkSync(tempPathRaw);
                    if (fs.existsSync(tempPathTrimmed)) fs.unlinkSync(tempPathTrimmed);
                    if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
                    return interaction.editReply({
                        content: '❌ Wystąpił błąd podczas pobierania i zapisywania pliku na serwerze.'
                    });
                }
            }

            if (subcommand === 'emoji') {
                try {
                    const category = interaction.options.getString('kategoria').trim();
                    const soundInput = interaction.options.getString('dzwiek');
                    const emojiInput = interaction.options.getString('emoji').trim();
                    const matchedFile = findAudioFile(category, soundInput);
                    if (!matchedFile) {
                        console.error(`[Sound Emoji] Nie znaleziono dźwięku "${soundInput}" w kategorii "${category}":`, error);
                        return interaction.editReply({
                            content: `❌ Nie znaleziono dźwięku **"${soundInput}"** w kategorii **${category}**.`,
                            flags: 64
                        });
                    }
                    const buttonKey = `${category}/${matchedFile}`;
                    buttonEmojis[buttonKey] = emojiInput;
                    if (typeof saveConfig === 'function') saveConfig();
                    await renderFullSoundboard(interaction.channel);
                    console.log(`[Sound Emoji] Ustawiono emoji "${emojiInput}" dla przycisku "${matchedFile}" w kategorii "${category}":`, error);
                    return interaction.editReply({
                        content: `✅ Ustawiono emoji **${emojiInput}** dla przycisku **${matchedFile}** w kategorii **${category}**.`
                    });
                } catch (error) {
                    console.error('[Sound Emoji] Błąd podczas ustawiania emoji:', error);
                    return interaction.editReply({
                        content: `❌ Wystąpił błąd podczas ustawiania emoji: ${error.message}`
                    });
                }
            }

            if (subcommand === 'rename') {
                const category = interaction.options.getString('kategoria').trim();
                const soundInput = interaction.options.getString('dzwiek').trim();
                const newName = interaction.options.getString('nowa_nazwa').trim();
                const matchedFile = findAudioFile(category, soundInput);
                if (!matchedFile) {
                    console.error(`[Sound-Rename] Nie znaleziono dźwięku "${soundInput}" w kategorii "${category}":`, error);
                    return interaction.editReply({
                        content: `❌ Nie znaleziono dźwięku **"${soundInput}"** w kategorii **${category}**.`,
                        flags: 64
                    });
                }
                const soundKey = `${category}/${matchedFile}`;
                if (typeof soundDisplayNames !== 'undefined') soundDisplayNames[soundKey] = newName;
                if (typeof saveConfig === 'function') saveConfig();
                await renderFullSoundboard(interaction.channel);
                console.log(`[Sound-Rename] Zmieniono wyświetlaną nazwę dla "${matchedFile}" w kategorii "${category}" na "${newName}":`, error);
                return interaction.editReply({
                    content: `✅ Zmieniono wyświetlaną nazwę dla **${matchedFile}** w kategorii **${category}** na **${newName}**.`,
                    flags: 64
                });
            }

            if (subcommand === 'delete') {
                const category = interaction.options.getString('kategoria').trim();
                const soundInput = interaction.options.getString('dzwiek') || interaction.options.getString('plik');
                if (!soundInput) {
                    console.error('[Sound-Delete] Nie podano nazwy dźwięku do usunięcia:', error);
                    return interaction.editReply({
                        content: '❌ Nie podano nazwy dźwięku do usunięcia.',
                        flags: 64
                    });
                }
                const matchedFile = findAudioFile(category, soundInput);
                if (!matchedFile) {
                    console.error(`[Sound-Delete] Nie znaleziono dźwięku "${soundInput}" w kategorii "${category}":`, error);
                    return interaction.editReply({
                        content: `❌ Nie znaleziono dźwięku **"${soundInput}"** w kategorii **${category}**.`,
                        flags: 64
                    });
                }
                const filePath = path.join(SOUNDS_DIR, category, matchedFile);
                try {
                    fs.unlinkSync(filePath);
                    const buttonKey = `${category}/${matchedFile}`;
                    delete buttonEmojis[buttonKey];
                    if (typeof soundDisplayNames !== 'undefined') {
                        delete soundDisplayNames[buttonKey];
                    }
                    if (typeof saveConfig === 'function') saveConfig();
                    await renderFullSoundboard(interaction.channel);
                    console.log(`[Sound-Delete] Pomyślnie usunięto dźwięk "${soundInput}" z kategorii "${category}":`, error);
                    return interaction.editReply({
                        content: `🗑️ Pomyślnie usunięto dźwięk **${soundInput}** z kategorii **${category}**!`,
                        flags: 64
                    });
                } catch (error) {
                    console.error('[Sound-Delete] Błąd podczas usuwania pliku:', error);
                    return interaction.editReply({
                        content: `❌ Wystąpił błąd podczas usuwania pliku z dysku: ${error.message}`,
                        flags: 64
                    });
                }
            }

            if (subcommand === 'normalize') {
                const categoryInput = interaction.options.getString('kategoria');
                const soundInput = interaction.options.getString('dzwiek');
                if (categoryInput && soundInput) {
                    const matchedFile = findAudioFile(categoryInput, soundInput);
                    console.error(`[Sound-Normalize] Nie znaleziono dźwięku "${soundInput}" w kategorii "${categoryInput}":`, error);
                    if (!matchedFile) {
                        return interaction.editReply({
                            content: `❌ Nie znaleziono dźwięku **"${soundInput}"** w kategorii **${categoryInput}**.`
                        });
                    }
                    const targetPath = path.join(SOUNDS_DIR, categoryInput, matchedFile);
                    try {
                        await normalizeSingleFile(targetPath);
                        console.log(`[Sound-Normalize] Pomyślnie znormalizowano dźwięk "${matchedFile}" w kategorii "${categoryInput}"`, error);
                        return interaction.editReply({
                            content: `✅ Pomyślnie znormalizowano dźwięk **${matchedFile}** w kategorii **${categoryInput}** do **-16 LUFS**.`
                        });
                    } catch (err) {
                        console.error(`[Sound-Normalize] Błąd podczas normalizacji dźwięku "${matchedFile}"`, error);
                        return interaction.editReply({
                            content: `❌ Błąd podczas normalizacji dźwięku **${matchedFile}**: \`${err.message}\``
                        });
                    }
                }
                if (categoryInput && !soundInput) {
                    const targetDir = path.join(SOUNDS_DIR, categoryInput);
                    if (!fs.existsSync(targetDir)) {
                        console.error(`[Sound-Normalize] Kategoria/folder "${categoryInput}" nie istnieje:`, error);
                        return interaction.editReply({
                            content: `❌ Kategoria/folder **"${categoryInput}"** nie istnieje.`
                        });
                    }
                    try {
                        await normalizeMultipleFiles(files);
                        console.log(`[Sound-Normalize] Pomyślnie znormalizowano wszystkie dźwięki ("${files.length}" szt.) w kategorii "${categoryInput}"`, error);
                        return interaction.editReply({
                            content: `✅ Pomyślnie znormalizowano wszystkie dźwięki (**${files.length}** szt.) w kategorii **${categoryInput}**!`
                        });
                    } catch (err) {
                        console.error(`[Sound-Normalize] Błąd podczas normalizacji kategorii "${categoryInput}":`, error);
                        return interaction.editReply({
                            content: `❌ Błąd podczas normalizacji kategorii **${categoryInput}**: \`${err.message}\``
                        });
                    }
                }
                if (!categoryInput && !soundInput) {
                    if (!fs.existsSync(SOUNDS_DIR)) {
                        console.error(`[Sound-Normalize] Katalog nie istnieje:`, error);
                        return interaction.editReply({
                            content: '❌ Katalog `sounds/` nie istnieje.'
                        });
                    }
                    const allFiles = [];
                    const categories = fs.readFileSync(SOUNDS_DIR, { withFileTypes: true })
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
                        console.log('[Sound-Normalize] Biblioteka jest pusta. Brak plików do znormalizowania.');
                        return interaction.editReply({
                            content: '⚠️ Biblioteka soundboardu jest pusta. Brak plików do znormalizowania.'
                        });
                    }
                    try {
                        await normalizeMultipleFiles(allFiles);
                        console.log(`[Sound-Normalize] Pomyślnie znormalizowano całą bibliotekę. Przeproprocesowano "${allFiles.length}" plików.`);
                        return interaction.editReply({
                            content: `✅ Pomyślnie znormalizowano **całą bibliotekę**! Przeproprocesowano **${allFiles.length}** plików audio we wszystkich kategoriach.`
                        });
                    } catch (err) {
                        console.error(`[Sound-Normalize] Błąd podczas normalizacji biblioteki:`, error);
                        return interaction.editReply({
                            content: `❌ Błąd podczas normalizacji biblioteki: \`${err.message}\``
                        });
                    }
                }
            }

            if (interaction.commandName === 'category') {
                const subcommand = interaction.options.getSubcommand();
                await interaction.deferReply({ flags: 64 });
                if (subcommand === 'create') {
                    const rawCategoryName = interaction.options.getString('nazwa').trim();
                    const folderName = clearFolderName(rawCategoryName);
                    if (!folderName) {
                        console.error('[Category-Create] Podano nieprawidłową nazwę kategorii', error);
                        return interaction.editReply({
                            content: '❌ Podano nieprawidłową nazwę kategorii.'
                        });
                    }
                    const targetPath = path.join(SOUNDS_DIR, folderName);
                    if (!fs.existsSync(targetPath)) {
                        fs.mkdirSync(targetPath, { recursive: true });
                    }
                    categoryNames[folderName] = rawCategoryName;
                    saveConfig();
                    await renderFullSoundboard(interaction.channel);
                    console.log(`[Category-Create] Pomyślnie utworzono kategorię "${rawCategoryName}". Folder na serwerze: \`sounds/${folderName}\``);
                    return interaction.editReply({
                        content: `✅ Pomyślnie utworzono kategorię **${rawCategoryName}** (Folder na serwerze: \`sounds/${folderName}\`).`,
                        flags: 64
                    });
                }
                const category = interaction.options.getString('kategoria');
                if (subcommand === 'rename') {
                    const categoryFolder = interaction.options.getString('kategoria').trim();
                    const newDisplayName = interaction.options.getString('nowa_nazwa').trim();
                    categoryNames[categoryFolder] = newDisplayName;
                    saveConfig();
                    await renderFullSoundboard(interaction.channel);
                    console.log(`[Category-Rename] Zmieniono nazwę kategorii "${category}" na "${newName}"`);
                    return interaction.editReply({ content: `Zmieniono wyświetlaną nazwę kategorii **${category}** na **${newName}**`, flags: 64 });
                }
                if (subcommand === 'hide') {
                    hiddenCategories.add(category);
                    saveConfig();
                    await renderFullSoundboard(interaction.channel);
                    console.log(`[Category-Hide] Ukryto kategorię "${category}"`);
                    return interaction.editReply({ content: `Ukryto kategorię **${category}**`, flags: 64 });
                }
                /*
                if (subcommand === 'show') {
                    hiddenCategories.delete(category);
                    saveConfig();
                    await renderFullSoundboard(interaction.channel);
                    return interaction.editReply({ content: `Przywrócono kategorię **${category}**`, flags: 64 });
                }
                    */
                if (subcommand === 'delete') {
                    const targetPath = path.join(SOUNDS_DIR, category);
                    if (!fs.existsSync(targetPath)) {
                        console.error(`[Category-Delete] Kategoria/folder "${category}" nie istnieje na serwerze.`. error);
                        return interaction.editReply({ content: `❌ Kategoria/folder \`${category}\` nie istnieje na serwerze.` });
                    }
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`cat_delete_files:${category}`)
                            .setLabel('Usuń kategorię ORAZ pliki z dysku')
                            .setStyle(ButtonStyle.Danger),
                        new ButtonBuilder()
                            .setCustomId(`cat_delete_panel_only:${category}`)
                            .setLabel('Usuń tylko z panelu (zostaw pliki)')
                            .setStyle(ButtonStyle.Secondary)
                    );
                    return interaction.editReply({
                        content: `⚠️ **Czy na pewno chcesz usunąć kategorię \`${category}\`?**\nWybierz opcję poniżej:`,
                        components: [row]
                    });
                }
                if (subcommand === 'color') {
                    const colorValue = interaction.options.getString('kolor');
                    const colorMap = {
                        'Primary': ButtonStyle.Primary,
                        'Secondary': ButtonStyle.Secondary,
                        'Success': ButtonStyle.Success,
                        'Danger': ButtonStyle.Danger
                    };
                    categoryColors[category] = colorMap[colorValue] || ButtonStyle.Primary;
                    saveConfig();
                    await renderFullSoundboard(interaction.channel);
                    console.log(`[Category-Color] Zmieniono kolor przycisków dla kategorii "${category}" na "${colorValue}"`);
                    return interaction.editReply({
                        content: `🎨 Zmieniono kolor przycisków dla kategorii **${category}** na: **${colorValue}**.`
                    });
                }
            }
        }
    }
    // Buttons
    if (!interaction.isButton()) return;
    const action = interaction.customId;
    if (action.startsWith('quickplay:')) {
        const voiceChannel = interaction.member?.voice?.channel;
        if (!voiceChannel) {
            return interaction.reply({ content: 'Hej kolego, wpadnij do nas to może pośmiejemy się razem xD', flags: 64 });
        }
        const [, cat, file] = action.split(':');
        playSoundTrack(voiceChannel, cat, file, interaction.user.username);
        await interaction.deferUpdate();
        await updateMainPanel(interaction.member);
        return;
    }
    if (action.startsWith('stop_track:')) {
        const trackId = action.split(':')[1];
        stopSingleTrack(interaction.guildId, trackId);
        await interaction.deferUpdate();
        await updateMainPanel(interaction.member);
        return;
    }
    if (action === 'ctrl_stop_all') {
        stopAllTracks(interaction.guildId);
        await interaction.deferUpdate();
        console.log('[PLAYER] Stopped all tracks');
        await updateMainPanel(interaction.member);
        return;
    }
    if (action === 'sys_rebuild_all') {
        await interaction.deferUpdate();
        console.log('[REBUILD] Przebudowano panel');
        await renderFullSoundboard(interaction.channel);
        return;
    }
    if (action.startsWith('cat_delete_files:')) {
        const catToDelete = action.split(':')[1];
        const targetPath = path.join(SOUNDS_DIR, catToDelete);
        await interaction.deferUpdate();
        if (fs.existsSync(targetPath)) {
            fs.rmSync(targetPath, { recursive: true, force: true });
        }
        delete categoryNames[catToDelete];
        delete categoryColors[catToDelete];
        hiddenCategories.delete(catToDelete);
        saveConfig();
        await renderFullSoundboard(interaction.channel);
        console.log(`[DELETION] Usunięto kategorię "${catToDelete}" oraz skasowano z dysku!`);
        return interaction.editReply({
            content: `🗑️ **Usunięto kategorię \`${catToDelete}\` oraz skasowano z dysku!**`,
            components: []
        });
    }
    if (action.startsWith('cat_delete_panel_only:')) {
        const catToDelete = action.split(':')[1];
        await interaction.deferUpdate();
        hiddenCategories.add(catToDelete);
        delete categoryNames[catToDelete];
        saveConfig();
        await renderFullSoundboard(interaction.channel);
        console.log(`[DELETION] Usunięto kategorię "${catToDelete}"`);
        return interaction.editReply({
            content: `**Kategoria \`${catToDelete}\` została usunięta z panelu**`,
            components: []
        });
    }

    // Modal
    if (interaction.isButton() && interaction.customId === 'sys_manage') {
        const modal = new ModalBuilder()
            .setCustomId('modal_manage_category')
            .setTitle('Zarządzanie kategoriami');
        const folderNameInput = new TextInputBuilder()
            .setCustomId('folder_name')
            .setLabel('Identyfikator / Nazwa folderu')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('np. polskie_memy')
            .setRequired(true);
        const displayNameInput = new TextInputBuilder()
            .setCustomId('display_name')
            .setLabel('Wyświetlana nazwa z Emoji')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('np. POLSKIE MEMY')
            .setRequired(false);
        modal.addComponents(
            new ActionRowBuilder().addComponents(folderNameInput),
            new ActionRowBuilder().addComponents(displayNameInput)
        );
        return await interaction.showModal(modal);
    }
}
module.exports = { handleInteraction };