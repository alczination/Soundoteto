// Interaction-Handler (Commands and Buttons)
const fs = require('fs');
const path = require('path');
const https = require('https');
const { exec } = require('child_process');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const {
    playSoundTrack,
    stopSingleTrack,
    stopAllTracks,
    SOUNDS_DIR
} = require('../audio/audioManager');
const {
    buildMainDashboard,
    updateMainPanel,
    renderFullSoundboard,
    categoryNames,
    categoryColors,
    categoryEmojis,
    buttonEmojis,
    hiddenCategories,
    saveConfig
} = require('../ui/uiBuilders');

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
            fs.unlink(destPath, () => {});
            reject(err);
        });
    });
}

function normalizeSingleFile(filePath) {
    return new Promise((resolve, reject) => {
        const ext = path.extname(filePath).replace('.', '');
        const command = `ffmpeg-normalize "${filePath}" -ext ${ext} -c:a libmp3lame -b:a 192k -nt ebu --target-level=-16 -f`;
        const env = { 
            ...process.env, 
            PATH: `${process.env.PATH}:/root/.local/bin:/home/discord_soundboard/.local/bin:/usr/local/bin` 
        };
        exec(command, { env }, (error, stdout, stderr) => {
            if (error) {
                console.error(`[Normalizacja] Błąd dla ${filePath}:`,stderr || error.message);
                return reject(new Error(stderr || error.message));
            }
            console.log(`[Normalizacja] Pomyślnie znormalizowano plik: ${filePath}`);
            resolve(true);
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
                        name: categoryNames[cat] ? `${categoryNames[cat]} (${cat})` :  cat,
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
            await updateMainPanel();
            return interaction.reply({
                content: '🛑 **Zatrzymano wszystkie dźwięki.**',
                flags: 64
            });
        }
        if (interaction.commandName === 'disconnect') {
            const minutes = interaction.options.getInteger('czas');
            const { setAutoDisconnectMinutes } = require('../audio/audioManager');
            setAutoDisconnectMinutes(minutes);
            if (minutes === 0) {
                return interaction.reply({
                    content: 'Automatyczny disconnect został **wyłączony**',
                    flags: 64
                });
            } else {
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
                const category = interaction.options.getString('kategoria').trim();
                const attachment = interaction.options.getAttachment('plik');
                const customNameInput = interaction.options.getString('nazwa');
                const emojiInput = interaction.options.getString('emoji');
                const extension = path.extname(attachment.name).toLowerCase();
                if (extension !== '.mp3' && extension !== '.wav') {
                    return interaction.editReply({
                        content: '❌ Niepoprawny format! Akceptowane są wyłącznie pliki z rozszerzeniem `.mp3` lub `.wav`.',
                        flags: 64
                    });
                }
                const targetDir = path.join(SOUNDS_DIR, category);
                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                }
                const fileName = clearFileName(customNameInput, attachment.name, extension);
                const targetPath = path.join(targetDir, fileName);
                const tempPath = path.join(targetDir, `temp_${Date.now()}_${fileName}`);
                try {
                    await downloadFile(attachment.url, tempPath);
                    await normalizeSingleFile(tempPath);
                    fs.renameSync(tempPath, targetPath);
                    if (emojiInput) {
                        const buttonKey = `${category}/${fileName}`;
                        buttonEmojis[buttonKey] = emojiInput.trim();
                        if (typeof saveConfig === 'function') saveConfig();
                    }
                    await renderFullSoundboard(interaction.channel);
                    return interaction.editReply({
                        content: `✅ Pomyślnie dodano dźwięk **${fileName}** do kategorii **${category}**!${emojiInput ? ` (Emoji: ${emojiInput})` : ''}`
                    });
                } catch (error) {
                    console.error('Błąd podczas zapisywania dźwięku:', error);
                    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
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
                    return interaction.editReply({
                        content: `❌ Nie znaleziono dźwięku **"${soundInput}"** w kategorii **${category}**.`,
                        flags: 64
                    });
                }
                const buttonKey = `${category}/${matchedFile}`;
                buttonEmojis[buttonKey] = emojiInput;
                if (typeof saveConfig === 'function') saveConfig(); 
                await renderFullSoundboard(interaction.channel);
                return interaction.editReply({
                    content: `✅ Ustawiono emoji **${emojiInput}** dla przycisku **${matchedFile}** w kategorii **${category}**.`
                });
            } catch (error) {
                console.error('Błąd podczas ustawiania emoji:', error);
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
                    return interaction.editReply({
                        content: `❌ Nie znaleziono dźwięku **"${soundInput}"** w kategorii **${category}**.`,
                        flags: 64
                    });
                }
                const soundKey = `${category}/${matchedFile}`;
                if (typeof soundDisplayNames !== 'undefined') soundDisplayNames[soundKey] = newName;
                if (typeof saveConfig === 'function') saveConfig();
                await renderFullSoundboard(interaction.channel);
                return interaction.editReply({
                    content: `✅ Zmieniono wyświetlaną nazwę dla **${matchedFile}** w kategorii **${category}** na **${newName}**.`,
                    flags: 64
                });
            }

            if (subcommand === 'delete') {
                const category = interaction.options.getString('kategoria').trim();
                const soundInput = interaction.options.getString('dzwiek') || interaction.options.getString('plik');
                if (!soundInput) {
                    return interaction.editReply({
                        content: '❌ Nie podano nazwy dźwięku do usunięcia.',
                        flags: 64
                    });
                }
                const matchedFile = findAudioFile(category, soundInput);
                if (!matchedFile) {
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
                    return interaction.editReply({
                        content: `🗑️ Pomyślnie usunięto dźwięk **${soundInput}** z kategorii **${category}**!`,
                        flags: 64
                    });
                } catch (error) {
                    console.error('Błąd podczas usuwania pliku:', error);
                    return interaction.editReply({
                        content: `❌ Wystąpił błąd podczas usuwania pliku z dysku: ${error.message}`,
                        flags: 64
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
                if (!folderName) return interaction.editReply({ content: '❌ Podano nieprawidłową nazwę kategorii.' });
                const targetPath = path.join(SOUNDS_DIR, folderName);
                if (!fs.existsSync(targetPath)) {
                    fs.mkdirSync(targetPath, { recursive: true });
                }
                categoryNames[folderName] = rawCategoryName;
                saveConfig();
                await renderFullSoundboard(interaction.channel);
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
                return interaction.editReply({ content: `Zmieniono wyświetlaną nazwę kategorii **${category}** na **${newName}**`, flags: 64 });
            }
            if (subcommand === 'hide') {
                hiddenCategories.add(category);
                saveConfig();
                await renderFullSoundboard(interaction.channel);
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
                return interaction.editReply({
                    content: `🎨 Zmieniono kolor przycisków dla kategorii **${category}** na: **${colorValue}**.`
                });
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
        await updateMainPanel();
        return;
    }
    if (action.startsWith('stop_track:')) {
        const trackId = action.split(':')[1];
        stopSingleTrack(trackId);
        await interaction.deferUpdate();
        await updateMainPanel();
        return;
    }
    if (action === 'ctrl_stop_all') {
        stopAllTracks();
        await interaction.deferUpdate();
        await updateMainPanel();
        return;
    }
    if (action === 'sys_rebuild_all') {
        await interaction.deferUpdate();
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
        return interaction.editReply({
            content: `**Kategoria \`${catToDelete}\` została usunięta z panelu**`,
            components: []
        });
    }
}
module.exports = { handleInteraction };