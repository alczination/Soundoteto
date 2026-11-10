const {
    toggleAudioEffect,
    getAudioEffectsConfig,
    AUDIO_EFFECTS
} = require('../extras/sound_effects');
const {
    views
} = require('../ui/menuViews');

async function handleSelectMenuInteraction(interaction) {
    if (interaction.customId === 'fx_select') {
        const selected = new Set(interaction.values);
        const cfg = getAudioEffectsConfig();
        for (const key of Object.keys(AUDIO_EFFECTS)) {
            if (!!cfg[key] !== selected.has(key)) {
                toggleAudioEffect(key, interaction.guildId);
            }
        }
        return interaction.update(views.addons());
    }
    const [prefix] = interaction.customId.split(':');
    if (prefix === 'cat_pick') {}
}

module.exports = { handleSelectMenuInteraction };