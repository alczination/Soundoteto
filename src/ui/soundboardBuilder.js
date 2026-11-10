// ** Responsible for building message categories, favorite panel 
// and sync Discord Guild Icons ** //
const fs = require('fs');
const path = require('path');

const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    MessageFlags
} = require('discord.js');
const { 
    SOUNDS_DIR 
} = require('../audio/playerService');
const {
    userFavorites,
    categoryNames,
    categoryColors,
    categoryEmojis,
    buttonEmojis,
    soundDisplayNames,
    hiddenCategories,
    saveConfig
} = require('./configManager');

async function syncLocalIconsToGuild(guild) {
    if (!guild) return;
    const baseIconDir = path.join(__dirname, '../../ico');
    if (!fs.existsSync(baseIconDir)) return;
    if (!fs.existsSync(SOUNDS_DIR)) return;

    const categories = fs.readdirSync(SOUNDS_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory() && d.name !== 'ico' && !hiddenCategories.has(d.name))
        .map(d => d.name);

    const catIconDir = path.join(baseIconDir, 'categories');
    if (fs.existsSync(catIconDir)) {
        const catFiles = fs.readdirSync(catIconDir, { withFileTypes: true })
            .filter(item => item.isFile() && /\.(png|jpg|jpeg|ico|gif)$/i.test(item.name))
            .map(item => item.name);
        for (const catFile of catFiles) {
            const catName = path.parse(catFile).name;
            if (categories.includes(catName) && !categoryEmojis[catName]) {
                const icoPath = path.join(catIconDir, catFile);
                try {
                    const safeEmojiName = `cat_ico_${catName}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 32);
                    existingEmoji = guild.emojis.cache.find(e => e.name === safeEmojiName);
                    if (!existingEmoji) {
                        console.log(`[SOUNDBOARD BUILDER] Wgrywanie ikony kategorii z ico/categories/: ${catFile}`);
                        existingEmoji = await guild.emojis.create({
                            attachment: icoPath,
                            name: safeEmojiName
                        });
                    }
                    categoryEmojis[catName] = `<:${existingEmoji.name}:${existingEmoji.id}>`;
                    saveConfig();
                    console.log(`[SOUNDBOARD BUILDER] Przypisano ikonę do kategorii ${catName}`);
                } catch (err) {
                    console.error(`[SOUNDBOARD BUILDER] Błąd wgrywania ikony kategorii ${catName}`);
                }
            }
        }
    }
    const buttonFiles = fs.readdirSync(baseIconDir, { withFileTypes: true })
        .filter(item => item.isFile() && /\.(png|jpg|jpeg|ico|gif)$/i.test(item.name))
        .map(item => item.name);
    for (const icoFile of buttonFiles) {
        const baseName = path.parse(icoFile).name;
        for (const cat of categories) {
            const mp3File = `${baseName}.mp3`;
            const wavFile = `${baseName}.wav`;
            const catPath = path.join(SOUNDS_DIR, cat);
            const targetAudio = fs.existsSync(path.join(catPath, mp3File)) ? mp3File
                : (fs.existsSync(path.join(catPath, wavFile)) ? wavFile : null);
            if (targetAudio) {
                const buttonKey = `${cat}/${targetAudio}`;
                if (buttonEmojis[buttonKey]) break;
                const icoPath = path.join(baseIconDir, icoFile);
                try {
                    const safeEmojiName = `ico_${cat}_${baseName}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 32);
                    let existingEmoji = guild.emojis.cache.find(e => e.name === safeEmojiName);
                    if (!existingEmoji) {
                        console.log(`[SOUNDBOARD BUILDER] Wgrywanie nowej ikony z folderu ikon: ${icoFile}`);
                        existingEmoji = await guild.emojis.create({
                            attachment: icoPath,
                            name: safeEmojiName
                        });
                    }
                    buttonEmojis[buttonKey] = `<:${existingEmoji.name}:${existingEmoji.id}>`;
                    saveConfig();
                    console.log(`[SOUNDBOARD BUILDER] Przypisano ikonę ${icoFile} do przycisku ${buttonKey}`);
                } catch (err) {
                    console.error(`[SOUNDBOARD BUILDER] Błąd podczas wgrywania ${icoFile}:`, err.message);
                }
                break;
            }
        }
    }
}

function buildUserFavoritesMessage(userId, userUsername) {
    const favoritesList = userFavorites[userId] || [];
    const embed = new EmbedBuilder()
        .setTitle(`⭐ Ulubione dźwięki: ${userUsername}`)
        .setColor(0xF1C40F)
        .setDescription(
            favoritesList.length > 0
                ? `Liczba ulubionych dźwięków: **${favoritesList.length}**`
                : '*Nie masz jeszcze żadnych ulubionych dźwięków. Użyj `/favorite add`, aby jakieś dodać*'
        );
        if (favoritesList.length === 0) {
            return { embeds: [embed], components: []};
        }
        const rows = [];
        let currentRow = new ActionRowBuilder();
        favoritesList.slice(0, 25).forEach((soundKey, index) => {
            const [category, file] = soundKey.split('/');
            const labelText = (typeof soundDisplayNames !== 'undefined' && soundDisplayNames[soundKey])
                ? soundDisplayNames[soundKey]
                : path.parse(file).name;
            if (index > 0 && index % 5 === 0) {
                rows.push(currentRow);
                currentRow = new ActionRowBuilder()
            }
            const button = new ButtonBuilder()
                .setCustomId(`quickplay:${category}:${file}`)
                .setLabel(labelText)
                .setStyle(ButtonStyle.Success);
            const specificEmoji = (typeof buttonEmojis !== 'undefined') ? buttonEmojis[soundKey] : null;
            if (specificEmoji) {
                try {
                    button.setEmoji(specificEmoji.trim());
                } catch (error) {}
            }
            currentRow.addComponents(button);
        });
        if (currentRow.components.length > 0) rows.push(currentRow);
        return { embeds: [embed], components: rows };
}

function buildCategoryMessage(categoryName) {
    const catPath = path.join(SOUNDS_DIR, categoryName);
    const files = fs.existsSync(catPath)
        ? fs.readdirSync(catPath, { withFileTypes: true })
            .filter(item => item.isFile() && (item.name.endsWith('.mp3') || item.name.endsWith('.wav')))
            .map(item => item.name)
        : [];
    const displayName = categoryNames[categoryName] || categoryName.replace(/_/g, ' ').toUpperCase();
    const buttonStyle = categoryColors[categoryName] || ButtonStyle.Primary;
    const catEmoji = categoryEmojis[categoryName] || null;
    const title = catEmoji ? `${catEmoji} ${displayName}` : displayName;
    const container = new ContainerBuilder().setAccentColor(0x3498DB);
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`# ${title}`)
    );
    if (files.length === 0) {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent('⚠️ *Brak plików audio w tym folderze.*')
        );
        return { components: [container], flags: MessageFlags.IsComponentsV2 };
    }
    container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );
    let currentRow = new ActionRowBuilder();
    files.slice(0, 25).forEach((file, index) => {
        if (index > 0 && index % 5 === 0) {
            container.addActionRowComponents(currentRow);
            currentRow = new ActionRowBuilder();
        }
        const soundKey = `${categoryName}/${file}`;
        const labelText = soundDisplayNames[soundKey] || path.parse(file).name;
        const button = new ButtonBuilder()
            .setCustomId(`quickplay:${categoryName}:${file}`)
            .setLabel(labelText.slice(0, 80))
            .setStyle(buttonStyle);
        const emoji = buttonEmojis[soundKey];
        if (emoji && typeof emoji === 'string') {
            try { button.setEmoji(emoji.trim()); }
            catch (err) { console.error(`[SOUNDBOARD BUILDER] Nieprawidłowe emoji dla ${soundKey}:`, err); }
        }
        currentRow.addComponents(button);
    });
    if (currentRow.components.length > 0) container.addActionRowComponents(currentRow);
    return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

module.exports = {
    syncLocalIconsToGuild,
    buildUserFavoritesMessage,
    buildCategoryMessage
};