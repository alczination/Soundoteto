const fs = require('fs');
const path = require('path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { SOUNDS_DIR } = require('../audio/playerService');
const {
    categoryNames,
    categoryColors,
    categoryEmojis,
    hiddenCategories,
    saveConfig,
    renderFullSoundboard,
    updateCategoryMessage
} = require('../ui/uiBuilders');
const { clearFolderName } = require('../utils/audioUtils');

function findCategory(categoryInput) {
    if (!categoryInput || !categoryInput.trim()) return null;
    const searchStr = categoryInput.trim().toLowerCase();
    const availableFolders = fs.existsSync(SOUNDS_DIR)
        ? fs.readdirSync(SOUNDS_DIR, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name)
        : [];
    return availableFolders.find(folderName => {
        const displayName = (categoryNames && categoryNames[folderName])
            ? categoryNames[folderName].toLowerCase()
            : null;
        const normalizedFolder = folderName.toLowerCase();
        const clearFolder = typeof clearFolderName === 'function' ? clearFolderName(folderName) : normalizedFolder;
        const clearInput = typeof clearFolderName === 'function' ? clearFolderName(categoryInput) : searchStr;
        return (displayName && displayName === searchStr) ||
            (displayName && displayName.includes(searchStr)) ||
            normalizedFolder === searchStr ||
            clearFolder === clearInput;
    }) || null;
}

async function categoryCreate(interaction, rawCategoryName) {
    if (!rawCategoryName || !rawCategoryName.trim()) {
        console.error('[CATEGORY HANDLER] Wprowadzono nieprawidłową nazwę kategorii');
        return interaction.editReply({
            content: '❌ Wprowadzono nieprawidłową nazwę kategorii!'
        });
    }
    const trimmedRawName = rawCategoryName.trim();
    const folderName = clearFolderName(trimmedRawName);
    if (!folderName) {
        console.error(`[CATEGORY HANDLER] Kategoria o nazwie ${trimmedRawName} zawiera niedozwolone znaki`);
        return interaction.editReply({
            content: '❌ Nazwa kategorii zawiera wyłącznie niedozwolone znaki!'
        });
    }
    // TODO: Sprawdzanie czy folder istnieje po nazwie wyświetlanej albo/i po nazwie folderu
    const targetDir = path.join(SOUNDS_DIR, folderName);
    if (fs.existsSync(targetDir)) {
        console.error(`[CATEGORY HANDLER] Kategoria o nazwie folderu ${trimmedRawName} już istnieje!`);
        return interaction.editReply({
            content: `⚠️ Kategoria / folder \`${folderName}\` już istnieje na serwerze!`
        });
    }
    const isDisplayNameTaken = Object.values(categoryNames).some(
        existingName => existingName.toLowerCase() === trimmedRawName.toLowerCase()
    );
    if (isDisplayNameTaken) {
        console.error(`[CATEGORY HANDLER] Kategoria o nazwie wyświetlanej ${trimmedRawName} już istnieje!`);
        return interaction.editReply({
            content: `⚠️ Kategoria o wyświetlanej nazwie **"${trimmedRawName}"** już istnieje! Wybierz inną nazwę.`
        });
    }
    fs.mkdirSync(targetDir, { recursive: true });
    categoryNames[folderName] = trimmedRawName;
    hiddenCategories.delete(folderName);
    if (typeof saveConfig === 'function') saveConfig();
    await renderFullSoundboard(interaction.channel);
    console.log(`[CATEGORY HANDLER] Pomyślnie utworzono nową kategorię ${rawCategoryName}, folder: \`sounds/${folderName}\``);
    return interaction.editReply({
        content: `✅ Pomyślnie utworzono nową kategorię **${rawCategoryName}**!\n📁 Utworzony folder: \`sounds/${folderName}\``
    });
}

async function categoryRename(interaction, categoryInput, newDisplayNameInput) {
    if (!categoryInput || !newDisplayNameInput) {
        console.error('[CATEGORY HANDLER] Nie podano nazwy kategorii lub nowej nazwy');
        return interaction.editReply({
            content: '❌ Nie podano nazwy kategorii lub nowej nazwy!'
        });
    }
    const matchedFolder = findCategory(categoryInput);
    if (!matchedFolder) {
        console.error(`[CATEGORY HANDLER] Nie znaleziono kategorii o nazwie ${categoryInput}`);
        return interaction.editReply({
            content: `❌ Nie znaleziono kategorii o nazwie **"${categoryInput}"**!`
        });
    }
    categoryNames[matchedFolder] = newDisplayNameInput;
    if (typeof saveConfig === 'function') saveConfig();
    await updateCategoryMessage(interaction.channel, matchedFolder);
    console.log(`[CATEGORY HANDLER] Zmieniono nazwę kategorii dla folderu ${matchedFolder} na ${newDisplayNameInput}`);
    return interaction.editReply({
        content: `✅ Zmieniono nazwę kategorii dla folderu \`${matchedFolder}\` na **${newDisplayNameInput}**!`
    });
}

async function categoryDelete(interaction, categoryInput) {
    if (!categoryInput) {
        return interaction.editReply({ content: `❌ Nie podano nazwy kategorii do usunięcia.` });
    }
    const matchedFolder = findCategory(categoryInput);
    if (!matchedFolder) {
        return interaction.editReply({
            content: `❌ Nie znaleziono kategorii o nazwie **"${categoryInput}"**!`
        });
    }
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`cat_delete_files:${matchedFolder}`)
            .setLabel('Usuń kategorię ORAZ pliki z dysku')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`cat_delete_panel_only:${matchedFolder}`)
            .setLabel('Usuń tylko z panelu (zostaw pliki)')
            .setStyle(ButtonStyle.Secondary)
    );
    const displayName = categoryNames[matchedFolder] || matchedFolder;
    return interaction.editReply({
        content: `⚠️ **Czy na pewno chcesz usunąć kategorię \`${displayName}\`?**\nWybierz opcję poniżej:`,
        components: [row]
    });
}

async function categorySetEmoji(interaction, categoryInput, emojiInput) {
    if (!categoryInput) {
        return interaction.editReply({
            content: '❌ Podaj nazwę kategorii.'
        });
    }
    const matchedFolder = findCategory(categoryInput);
    if (!matchedFolder) {
        return interaction.editReply({
            content: `❌ Nie znaleziono kategorii **"${categoryInput}"**.`
        });
    }
    const cleanEmoji = emojiInput?.trim() || null;
    categoryEmojis[matchedFolder] = cleanEmoji;
    if (typeof categories !== 'undefined' && categories[matchedFolder]) {
        categories[matchedFolder].emoji = cleanEmoji;
    }
    if (typeof saveConfig === 'function') saveConfig();
    await updateCategoryMessage(interaction.channel, matchedFolder);
    const displayName = categoryNames[matchedFolder] || matchedFolder;
    if (cleanEmoji) {
        return interaction.editReply({
            content: `✅ Ustawiono emoji **${cleanEmoji}** dla kategorii **${displayName}**!`
        });
    } else {
        return interaction.editReply({
            content: `✅ Pomyślnie usunięto emoji z kategorii **${displayName}**!`
        });
    }
}

module.exports = {
    findCategory,
    categoryCreate,
    categoryRename,
    categoryDelete,
    categorySetEmoji
};