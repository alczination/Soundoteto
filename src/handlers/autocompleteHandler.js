const fs = require('fs');
const path = require('path');
const { 
    SOUNDS_DIR 
} = require('../audio/playerService');
const { 
    categoryNames, 
    hiddenCategories, 
    soundDisplayNames 
} = require('../ui/uiBuilders');
const { 
    findCategory 
} = require('./categoryHandler');

async function handleAutocomplete(interaction) {
    const focusedOption = interaction.options.getFocused(true);
    if (focusedOption.name === 'kategoria' || focusedOption.name === 'nowa_kategoria') {
        try {
            let categories = fs.existsSync(SOUNDS_DIR)
                ? fs.readdirSync(SOUNDS_DIR, { withFileTypes: true })
                    .filter(d => d.isDirectory() && !hiddenCategories.has(d.name))
                    .map(d => d.name)
                : [];
            const focusedValue = focusedOption.value.toLowerCase();
            const filtered = categories.filter(folderName => {
                const displayName = (categoryNames[folderName] || folderName).toLowerCase();
                return displayName.includes(focusedValue) || folderName.toLowerCase().includes(focusedValue);
            });
            return await interaction.respond(
                filtered.slice(0, 25).map(folderName => {
                    const displayName = categoryNames[folderName] || folderName;
                    return {
                        name: displayName,
                        value: displayName
                    };
                })
            );
        } catch (error) {
            console.error('[AUTOCOMPLETE] Błąd podczas generowania podpowiedzi kategorii:', error);
        }
    }
    if (focusedOption.name === 'dzwiek' || focusedOption.name === 'plik') {
        try {
            const categoryInput = interaction.options.getString('kategoria');
            if (!categoryInput) return await interaction.respond([]);
            const matchedFolder = findCategory(categoryInput);
            if (!matchedFolder) return await interaction.respond([]);
            const targetDir = path.join(SOUNDS_DIR, matchedFolder);
            if (!fs.existsSync(targetDir)) return await interaction.respond([]);
            const files = fs.readdirSync(targetDir).filter(f => f.endsWith('.mp3') || f.endsWith('.wav'));
            const focusedValue = focusedOption.value.toLowerCase();
            const suggestions = files.map(file => {
                const soundKey = `${matchedFolder}/${file}`;
                const displayName = (typeof soundDisplayNames !== 'undefined' && soundDisplayNames[soundKey])
                    ? soundDisplayNames[soundKey]
                    : path.parse(file).name;
                return {
                    displayName: displayName,
                    fileName: file
                };
            }).filter(item =>
                item.displayName.toLowerCase().includes(focusedValue) ||
                item.fileName.toLowerCase().includes(focusedValue)
            );
            return await interaction.respond(
                suggestions.slice(0, 25).map(item => ({
                    name: item.displayName,
                    value: item.displayName
                }))
            );
        } catch (error) {
            console.error('[AUTOCOMPLETE] Błąd podpowiedzi dźwięków:', error);
        }
    }
    if (focusedOption.name === 'lektor') {
        const voices = [
            { name: 'Jacek [PL]', value: 'Jacek' },
            { name: 'Jan [PL]', value: 'Jan'},
            { name: 'Ewa [PL]', value: 'Ewa' },
            { name: 'Brian [EN]', value: 'Brian'},
            { name: 'Hans [DE]', value: 'Hans'},
            { name: 'Miguel [SP]', value: 'Miguel'},
            { name: 'Maxim [RU]', value: 'Maxim'},
            { name: 'Zhiyu [CH]', value: 'Zhiyu'},
        ];
        const focusedValue = focusedOption.value.toLowerCase();
        const filtered = voices.filter(v =>
            v.name.toLowerCase().includes(focusedValue) ||
            v.value.toLowerCase().includes(focusedValue)
        );
        return await interaction.respond(
            filtered.map(v => ({ name: v.name, value: v.value }))
        );
    }
}
module.exports = { handleAutocomplete };