const path = require('path');
const fs = require('fs');
const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    MessageFlags
} = require('discord.js');

const {
    playSoundTrack,
    stopSingleTrack,
    stopAllTracks,
    audioQueue,
    SOUNDS_DIR
} = require('../audio/playerService');
const { setAutoDisconnectMinutes } = require('../audio/voiceSessionManager');
const {
    switchPlaybackMode,
    isBarkaEnabled,
    setBarkaEnabled
} = require('../config/settingsManager');
const {
    toggleAudioEffect,
    getAudioEffectsConfig,
    AUDIO_EFFECTS
} = require('../extras/sound_effects');
const {
    views,
    EPHEMERAL_V2
} = require('../ui/menuViews');
const {
    updateMainPanel,
    renderFullSoundboard,
    buildMainDashboard,
    categoryMessageRefs,
    categoryNames,
    categoryColors,
    categoryEmojis,
    hiddenCategories,
    saveConfig
} = require('../ui/uiBuilders');
const { handleInteraction } = require('./interactionHandler');

async function handleButtonInteraction(interaction) {
    const action = interaction.customId;

    if (action.startsWith('quickplay:')) {
        const avatarUrl = interaction.user.displayAvatarURL({ extension: 'png', size: 128 });
        const voiceChannel = interaction.member?.voice?.channel;
        if (!voiceChannel) {
            return interaction.reply({ content: 'Hej kolego, wpadnij do nas to może pośmiejemy się razem xD', flags: 64 });
        }
        const [, cat, file] = action.split(':');
        playSoundTrack(voiceChannel, cat, file, interaction.user.username, interaction.user.id, avatarUrl);
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
        console.log('[FFMPEG] Stopped all tracks');
        await updateMainPanel(interaction.member);
        return;
    }

    if (action.startsWith('toggle_mode:')) {
        const targetMode = action.split(':')[1];
        switchPlaybackMode(targetMode, interaction.guildId);
        await interaction.deferUpdate();
        await updateMainPanel({ guild: interaction.guild });
        return;
    }

    if (action === 'remove_queue:') {
        const queueIndex = parseInt(interaction.customId.split(':')[1], 10);
        if (!isNaN(queueIndex) && queueIndex >= 0 && queueIndex < audioQueue.length) {
            const removedTrack = audioQueue.splice(queueIndex, 1)[0];
            console.log(`[QUEUE] Usuwanie z kolejki pozycji ${queueIndex}: "${removedTrack?.file}"`);
        }
        await interaction.deferUpdate();
        await updateMainPanel({ guild: interaction.guild });
        return;
    }

    const SYS_VIEWS = {
        sys_manage: 'manage',
        sys_settings: 'settings',
        sys_addons: 'addons',
        sys_commands: 'commands',
    };

    if (SYS_VIEWS[action]) {
        const viewFunction = views[SYS_VIEWS[action]];
        if (!viewFunction) return;
        if (interaction.message.flags.has(MessageFlags.Ephemeral)) {
            return interaction.update(viewFunction(interaction));
        } else {
            return interaction.reply({
                ...viewFunction(interaction),
                flags: EPHEMERAL_V2
            });
        }
    }

    if (action.startsWith('nav:')) {
        const targetView = action.split(':')[1];
        if (!views[targetView]) {
            return interaction.update(views[targetView](interaction));
        }
    }

    if (action.startsWith('set_disc:')) {
        setAutoDisconnectMinutes(parseInt(action.split(':')[1], 10));
        return interaction.update(views.settings(interaction));
    }

    if (action.startsWith('set_mode:')) {
        const newMode = action.split(':')[1];
        switchPlaybackMode(newMode);
        if (typeof views !== 'undefined' && views.settings)
            return interaction.update(views.settings(interaction));
        const dashboard = buildMainDashboard(interaction.member);
        return interaction.update({
            embeds: dashboard.embeds,
            components: dashboard.components
        });
    }

    if (action === 'sys_rebuild_all') {
        await interaction.deferUpdate();
        console.log('[CLIENT] Przebudowano panel');
        await renderFullSoundboard(interaction.channel);
        return;
    }

    if (action === 'cat_action_add') {
        const modal = new ModalBuilder()
            .setCustomId('modal_create_category')
            .setTitle('Tworzenie nowej kategorii');
        const nameInput = new TextInputBuilder()
            .setCustomId('cat_name_input')
            .setLabel('Nazwa kategorii')
            .setPlaceholder('np. Polskie memy')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
        return await interaction.showModal(modal);
    }

    if (action === 'cat_action_rename') {
        const modal = new ModalBuilder()
            .setCustomId('modal_rename_category')
            .setTitle('Zmiana nazwy kategorii');
        const catSelectInput = new TextInputBuilder()
            .setCustomId('cat_folder_input')
            .setLabel('Nazwa folderu')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('np. Żydowskie memy')
            .setRequired(true);
        const newNameInput = new TextInputBuilder()
            .setCustomId('cat_new_name_input')
            .setLabel('Nowa nazwa')
            .setPlaceholder('np. Rasistowskie memy')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);
        modal.addComponents(
            new ActionRowBuilder().addComponents(catSelectInput),
            new ActionRowBuilder().addComponents(newNameInput)
        );
        return await interaction.showModal(modal);
    }

    if (action === 'cat_action_delete') {
        const modal = new ModalBuilder()
            .setCustomId('modal_delete_category')
            .setTitle('Usuwanie kategorii');
        const catInput = new TextInputBuilder()
            .setCustomId('cat_delete_input')
            .setLabel('Nazwa')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(catInput));
        return await interaction.showModal(modal);
    }

    if (action.startsWith('cat_confirm_create:')) {
        await interaction.deferUpdate();
        const [, folderName, rawCategoryEncoded] = action.split(':');
        const originalCategoryName = decodeURIComponent(rawCategoryEncoded);
        const targetDir = path.join(SOUNDS_DIR, folderName);
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }
        // TODO: Automatically go forward after creating a new category
        categoryNames[folderName] = originalCategoryName;
        if (typeof saveConfig === 'function') saveConfig();
        await renderFullSoundboard(interaction.channel);
        return interaction.editReply({
            content: `✅ Utworzono nową kategorię **"${originalCategoryName}"** (\`sounds/${folderName}\`)!`,
            components: []
        });
    }

    if (action.startsWith('cat_fallback_inne:')) {
        await interaction.deferUpdate();
        const fallbackFolder = 'inne';
        const targetDir = path.join(SOUNDS_DIR, fallbackFolder);
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
            categoryNames[fallbackFolder] = '❓ INNE';
            if (typeof saveConfig === 'function') saveConfig();
        }
        await renderFullSoundboard(interaction.channel);
        return interaction.editReply({
            content: `ℹ️ Przypisano dźwięk do kategorii **Inne** (\`sounds/inne\`).`,
            components: []
        });
    }

    if (action === 'sound_add_choice_url') {
        const modal = new ModalBuilder()
            .setCustomId('modal_add_sound_url')
            .setTitle('Dodawanie dźwięku z linku');
        const catInput = new TextInputBuilder()
            .setCustomId('sound_cat_input')
            .setLabel('Nazwa kategorii')
            .setPlaceholder('np. Rasistowskie memy')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);
        const urlInput = new TextInputBuilder()
            .setCustomId('sound_url_input')
            .setLabel('Link')
            .setPlaceholder('Link (YouTube/SoundCloud)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);
        const startInput = new TextInputBuilder()
            .setCustomId('sound_start_input')
            .setLabel('Początek (np. 0:02)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false);
        const endInput = new TextInputBuilder()
            .setCustomId('sound_end_input')
            .setLabel('Koniec (np. 0:30)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false);
        const nameInput = new TextInputBuilder()
            .setCustomId('sound_name_input')
            .setLabel('Nazwa wyświetlana')
            .setPlaceholder('np. Bartek się zesrał effect')
            .setStyle(TextInputStyle.Short)
            .setRequired(false);
        modal.addComponents(
            new ActionRowBuilder().addComponents(catInput),
            new ActionRowBuilder().addComponents(urlInput),
            new ActionRowBuilder().addComponents(startInput),
            new ActionRowBuilder().addComponents(endInput),
            new ActionRowBuilder().addComponents(nameInput),
        );
        return await interaction.showModal(modal);
    }

    if (action === 'sound_add_choice_file') {
        return interaction.reply({
            content: '📤 **Wgrywanie pliku z dysku:**\n' + 'Użyj komendy **`/sound add`**, aby dodać plik',
            flags: 64
        });
    }

    if (action === 'sound_action_rename') {
        const modal = new ModalBuilder()
            .setCustomId('modal_rename_sound')
            .setTitle('Zmiana nazwy dźwięku');
        const catInput = new TextInputBuilder()
            .setCustomId('sound_rename_cat_input')
            .setLabel('Nazwa kategorii')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);
        const soundInput = new TextInputBuilder()
            .setCustomId('sound_rename_sound_input')
            .setLabel('Obecna nazwa dźwięku')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);
        const newNameInput = new TextInputBuilder()
            .setCustomId('sound_rename_new_name_input')
            .setLabel('Nowa nazwa')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);
        modal.addComponents(
            new ActionRowBuilder().addComponents(catInput),
            new ActionRowBuilder().addComponents(soundInput),
            new ActionRowBuilder().addComponents(newNameInput)
        );
        return await interaction.showModal(modal);
    }

    if (action === 'sound_action_delete') {
        const modal = new ModalBuilder()
            .setCustomId('modal_delete_sound')
            .setTitle('Usuwanie dźwięku');
        const catInput = new TextInputBuilder()
            .setCustomId('sound_delete_cat_input')
            .setLabel('Nazwa kategorii')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);
        const soundInput = new TextInputBuilder()
            .setCustomId('sound_delete_sound_input')
            .setLabel('Nazwa dźwięku')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);
        modal.addComponents(
            new ActionRowBuilder().addComponents(catInput),
            new ActionRowBuilder().addComponents(soundInput)
        );
        return await interaction.showModal(modal);
    }

    if (action === 'sound_action_move') {
        // TODO
    }

    // ADDONS BUTTON BACKEND
    if (action === 'addon_toggle_barka') {
        const { isBarkaEnabled, setBarkaEnabled } = require('../config/settingsManager');
        const currentState = isBarkaEnabled();
        const newState = !currentState;
        setBarkaEnabled(newState);
        return interaction.update(views.addons());
    }

    if (action.startsWith('cat_delete_files:')) {
        const catToDelete = action.split(':')[1];
        const targetPath = path.join(SOUNDS_DIR, catToDelete);
        await interaction.deferUpdate();
        if (fs.existsSync(targetPath)) {
            fs.rmSync(targetPath, { recursive: true, force: true });
        }
        if (categoryMessageRefs.has(catToDelete)) {
            try {
                const msgRef = categoryMessageRefs.get(catToDelete);
                await msgRef.delete();
            } catch (error) { }
            categoryMessageRefs.delete(catToDelete);
        }
        delete categoryNames[catToDelete];
        delete categoryColors[catToDelete];
        delete categoryEmojis[catToDelete];
        hiddenCategories.delete(catToDelete);
        if (typeof saveConfig === 'function') saveConfig();
        console.log(`[CLIENT] Usunięto kategorię "${catToDelete}" oraz skasowano z dysku!`);
        return interaction.editReply({
            content: `🗑️ **Usunięto kategorię \`${catToDelete}\` oraz skasowano z dysku!**`,
            components: []
        });
    }

    if (action.startsWith('cat_delete_panel_only:')) {
        const catToDelete = action.split(':')[1];
        await interaction.deferUpdate();
        if (categoryMessageRefs.has(catToDelete)) {
            try {
                const msgRef = categoryMessageRefs.get(catToDelete);
                await msgRef.delete();
            } catch (error) { }
            categoryMessageRefs.delete(catToDelete);
        }
        hiddenCategories.add(catToDelete);
        delete categoryNames[catToDelete];
        if (typeof saveConfig === 'function') saveConfig();
        console.log(`[CLIENT] Usunięto kategorię "${catToDelete}"`);
        return interaction.editReply({
            content: `**Kategoria \`${catToDelete}\` została usunięta z panelu**`,
            components: []
        });
    }

    if (action.startsWith('fx_toggle:')) {
        const effectKey = action.split(':')[1];
        toggleAudioEffect(effectKey, interaction.guildId);
        return interaction.update(views.addons());
    }

    if (action === 'fx_reset') {
        const cfg = getAudioEffectsConfig();
        for (const key of Object.keys(AUDIO_EFFECTS)) {
            if (cfg[key]) toggleAudioEffect(key, interaction.guildId);
        }
        return interaction.update(views.addons());
    }
}

module.exports = { handleInteraction };