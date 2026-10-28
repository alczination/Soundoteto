// Connector to Discord
require('dotenv').config();
const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder
} = require('discord.js');
const { handleInteraction } = require('./src/handlers/interactionHandler');
const { handleVoiceStateChange } = require('./src/audio/audioManager');
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
    ]
});
const commands = [
    new SlashCommandBuilder()
        .setName('setup-panel')
        .setDescription('Otwiera panel dashboardu'),
    new SlashCommandBuilder()
        .setName('panel')
        .setDescription('Otwiera panel sterowania aktywnymi dźwiękami'),
    new SlashCommandBuilder()
        .setName('stopall')
        .setDescription('Stopuje wszystkie obecnie odtwarzane dźwięki'),
    new SlashCommandBuilder()
        .setName('disconnect')
        .setDescription('Automatyczne rozłączanie bota z kanału głosowego')
        .addIntegerOption(opt =>
            opt.setName('czas')
                .setDescription('Czas nieaktywności w min. (0 = wyłączone)')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('sound')
        .setDescription('Zarządzanie poszczególnymi dźwiękami')
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Dodaje nowy plik dźwiękowy do wybranej kategorii')
                .addStringOption(opt =>
                    opt.setName('kategoria')
                        .setDescription('Kategoria docelowa')
                        .setAutocomplete(true)
                        .setRequired(true))
                .addAttachmentOption(opt =>
                    opt.setName('plik')
                        .setDescription('Plik w formacie .mp3 lub .wav')
                        .setRequired(true))
                .addStringOption(opt =>
                    opt.setName('nazwa')
                        .setDescription('Nazwa efektu')
                        .setRequired(false))
                .addStringOption(opt =>
                    opt.setName('emoji')
                        .setDescription('Opcjonalne emoji')
                        .setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('emoji')
                .setDescription('Ustawia emoji dla konkretnego przycisku z dźwiękiem')
                .addStringOption(opt =>
                    opt.setName('kategoria')
                        .setDescription('Nazwa folderu kategorii')
                        .setAutocomplete(true)
                        .setRequired(true))
                .addStringOption(opt =>
                    opt.setName('dzwiek')
                        .setDescription('Nazwa dźwięku')
                        .setAutocomplete(true)
                        .setRequired(true))
                .addStringOption(opt =>
                    opt.setName('emoji')
                        .setDescription('Emoji Unicode lub Custom Emoji')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('rename')
                .setDescription('Zmienia nazwę dźwięku')
                .addStringOption(opt =>
                    opt.setName('kategoria')
                        .setDescription('Nazwa kategorii')
                        .setAutocomplete(true)
                        .setRequired(true))
                .addStringOption(opt =>
                    opt.setName('dzwiek')
                        .setDescription('Nazwa dźwięku')
                        .setAutocomplete(true)
                        .setRequired(true))
                .addStringOption(opt =>
                    opt.setName('nowa_nazwa')
                        .setDescription('Nowa wyświetlana nazwa')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('delete')
                .setDescription('Usuwa dźwięk')
                .addStringOption(opt =>
                    opt.setName('kategoria')
                        .setDescription('Nazwa kategorii')
                        .setAutocomplete(true)
                        .setRequired(true))
                .addStringOption(opt =>
                    opt.setName('dzwiek')
                        .setDescription('Nazwa dźwięku')
                        .setAutocomplete(true)
                        .setRequired(true))),
    new SlashCommandBuilder()
        .setName('category')
        .setDescription('Zarządzanie kategoriami soundboardu')
        .addSubcommand(sub =>
            sub.setName('create')
                .setDescription('Tworzy nową kategorię lub podpina istniejący folder z dysku')
                .addStringOption(opt => 
                    opt.setName('nazwa')
                        .setDescription('Nazwa nowej kategorii')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('rename')
                .setDescription('Zmienia wyświetlaną nazwę i emoji')
                .addStringOption(opt => 
                    opt.setName('kategoria')
                        .setDescription('Oryginalna nazwa kategorii')
                        .setAutocomplete(true)
                        .setRequired(true))
                .addStringOption(opt => 
                    opt.setName('nowa_nazwa')
                        .setDescription('Nowa nazwa')
                        .setAutocomplete(true)
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('hide')
                .setDescription('Ukrywa kategorię z panelu')
                .addStringOption(opt => 
                    opt.setName('kategoria')
                        .setDescription('Nazwa folderu kategorii')
                        .setAutocomplete(true)
                        .setRequired(true)))
                /*
        .addSubcommand(sub =>
            sub.setName('show')
                .setDescription('Pokazuje ukrytą kategorię')
                .addStringOption(opt => opt.setName('kategoria').setDescription('Nazwa folderu kategorii').setRequired(true)))
                */
        .addSubcommand(sub =>
            sub.setName('delete')
                .setDescription('Usuwa kategorię')
                .addStringOption(opt => 
                    opt.setName('kategoria')
                        .setDescription('Nazwa kategorii do usunięcia')
                        .setAutocomplete(true)
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('color')
                .setDescription('Zmienia kolor przycisków dla danej kategorii')
                .addStringOption(opt =>
                    opt.setName('kategoria')
                        .setDescription('Nazwa folderu kategorii:')
                        .setAutocomplete(true)
                        .setRequired(true))
                .addStringOption(opt =>
                    opt.setName('kolor')
                        .setDescription('Wybierz kolor przycisków')
                        .setRequired(true)
                        .addChoices(
                            { name: '🟦 Niebieski', value: 'Primary' },
                            { name: '🟩 Zielony', value: 'Success' },
                            { name: '🟥 Czerwony', value: 'Danger'},
                            { name: '⬛ Szary', value: 'Secondary'}
                        ))), 
].map(cmd => cmd.toJSON());

client.once('clientReady', async () => {
    console.log(`Bot zalogowany jako ${client.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log('Komendy pomyślnie zarejestrowane.');
    } catch (error) {
        console.error('Błąd rejestracji komend:', error);
    }
});

client.on('voiceStateUpdate', (oldState, newState) => {
    handleVoiceStateChange(oldState, newState);
});
client.on('interactionCreate', handleInteraction);
client.login(process.env.DISCORD_TOKEN);