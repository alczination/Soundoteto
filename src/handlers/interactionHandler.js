// Interaction-Handler (Commands and Buttons)
const { handleAutocomplete } = require('./autocompleteHandler');
const { handleModalSubmit } = require('./modalHandler');
const { handleChatInputCommand } = require('./commandHandler');
const { handleButtonInteraction } = require('./buttonHandler');
const { handleSelectMenuInteraction } = require('./selectMenuHandler');

async function handleInteraction(interaction) {
    if (interaction.isAutocomplete())
        return await handleAutocomplete(interaction);
    if (interaction.isModalSubmit())
        return await handleModalSubmit(interaction);
    if (interaction.isChatInputCommand())
        return await handleChatInputCommand(interaction);
    if (interaction.isStringSelectMenu())
        return await handleSelectMenuInteraction(interaction);
    if (interaction.isButton())
        return await handleButtonInteraction(interaction);
}

module.exports = { handleInteraction };