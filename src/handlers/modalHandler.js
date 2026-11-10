// Modal submit handler
const {
    categoryCreate,
    categoryRename,
    categoryDelete
} = require('./categoryHandler');
const {
    soundAdd,
    soundRename,
    soundDelete
} = require('./soundHandler');

async function handleModalSubmit(interaction) {
    const customId = interaction.customId;

    // Category-Modals
    if (customId === 'modal_create_category') {
        await interaction.reply({ content: '**Teto się opierdala... proszę czekać!**', flags: 64 });
        const rawName = interaction.fields.getTextInputValue('cat_name_input')?.trim();
        return await categoryCreate(interaction, rawName);
    }
    if (customId === 'modal_rename_category') {
        await interaction.reply({ content: '**Teto się opierdala... proszę czekać!**', flags: 64 });
        const categoryInput = interaction.fields.getTextInputValue('cat_folder_input')?.trim();
        const newNameInput = interaction.fields.getTextInputValue('cat_new_name_input')?.trim();
        return await categoryRename(interaction, categoryInput, newNameInput);
    }
    if (customId === 'modal_color_category') {
        // TODO
    }
    if (customId === 'modal_delete_category') {
        await interaction.reply({ content: '**Teto się opierdala... proszę czekać!**', flags: 64 });
        const categoryInput = interaction.fields.getTextInputValue('cat_delete_input')?.trim();
        return await categoryDelete(interaction, categoryInput);
    }

    // Sound-Modals
    if (customId === 'modal_add_sound_url') {
        await interaction.reply({ content: '**Teto się opierdala... proszę czekać!**', flags: 64 });
        return await soundAdd(interaction, {
            rawCategory: interaction.fields.getTextInputValue('sound_cat_input')?.trim(),
            urlInput: interaction.fields.getTextInputValue('sound_url_input')?.trim(),
            startTimeRaw: interaction.fields.getTextInputValue('sound_start_input')?.trim(),
            endTimeRaw: interaction.fields.getTextInputValue('sound_end_input')?.trim(),
            customNameInput: interaction.fields.getTextInputValue('sound_name_input')?.trim(),
        });
    }
    if (customId === 'modal_rename_sound') {
        await interaction.reply({ content: '**Teto się opierdala... proszę czekać!**', flags: 64 });
        const categoryInput = interaction.fields.getTextInputValue('sound_rename_cat_input')?.trim();
        const soundInput = interaction.fields.getTextInputValue('sound_rename_sound_input')?.trim();
        const newNameInput = interaction.fields.getTextInputValue('sound_rename_new_name_input')?.trim();
        return await soundRename(interaction, categoryInput, soundInput, newNameInput);
    }
    if (customId === 'modal_delete_sound') {
        await interaction.reply({ content: '**Teto się opierdala... proszę czekać!**', flags: 64 });
        const categoryInput = interaction.fields.getTextInputValue('sound_delete_cat_input')?.trim();
        const soundInput = interaction.fields.getTextInputValue('sound_delete_sound_input')?.trim();
        return await soundDelete(interaction, categoryInput, soundInput);
    }
}

module.exports = { handleModalSubmit };