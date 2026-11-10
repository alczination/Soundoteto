// Connector to Discord
require('dotenv').config();
const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder
} = require('discord.js');
const { 
    setMainPanelOffline,
    restorePanelReferences,
    startPanelTicker
} = require('./src/ui/uiBuilders');
const { 
    handleInteraction
} = require('./src/handlers/interactionHandler');
const { 
    handleVoiceStateChange
} = require('./src/audio/voiceSessionManager');
const { 
    setupBarkaCron 
} = require('./src/extras/cron/barka');
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
    ]
});

async function handleShutdown(signal) {
    console.log(`\n[CLIENT] Odebrano sygnał ${signal}. Zamykanie bota...`);
    try {
        await setMainPanelOffline();
        if (client) client.destroy();
    } catch (error) {
        console.error('[SYSTEM] Błąd podczas zamykania:', err);
    } finally {
        process.exit(0);
    }
}
process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

const commands = [
    new SlashCommandBuilder()
        .setName('setup-panel')
        .setDescription('Otwiera panel dashboardu'),
    new SlashCommandBuilder()
        .setName('panel')
        .setDescription('Otwiera panel sterowania aktywnymi dźwiękami'),
    new SlashCommandBuilder()
        .setName('play')
        .setDescription('Odtwarza muzykę ze Spotify lub YouTube')
        .addStringOption(opt =>
            opt.setName('query')
                .setDescription('Link Spotify/YouTube')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('favorite')
        .setDescription('Zarządzanie twoimi ulubionymi dźwiękami')
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('Wyświetla twoją listę dźwięków'))
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription("Dodaje dźwięk do ulubionych")
                .addStringOption(opt =>
                    opt.setName('kategoria')
                        .setDescription('Kategoria dźwięku')
                        .setAutocomplete(true)
                        .setRequired(true))
                .addStringOption(opt =>
                    opt.setName('dzwiek')
                        .setDescription('Nazwa dźwięku')
                        .setAutocomplete(true)
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Usuwa dźwięk z twoich ulubionych')
                .addStringOption(opt =>
                    opt.setName('dzwiek')
                        .setDescription('Dźwięk do usunięcia z ulubionych')
                        .setAutocomplete(true))),
    new SlashCommandBuilder()
        .setName('stopall')
        .setDescription('Stopuje wszystkie obecnie odtwarzane dźwięki'),
    new SlashCommandBuilder()
        .setName('disconnect')
        .setDescription('Automatyczne rozłączanie bota z kanału głosowego / Status Autodisconnect')
        .addIntegerOption(opt =>
            opt.setName('czas')
                .setDescription('Czas nieaktywności w min. (0 = wyłączone) / Zostaw puste, aby zobaczyć status')
                .setRequired(false)),
    new SlashCommandBuilder()
        .setName('tts')
        .setDescription('Generuje i odtwarza TTS')
        .addStringOption(opt =>
            opt.setName('lektor')
                .setDescription('Wybierz głos')
                .setAutocomplete(true)
                .setRequired(true))
        .addStringOption(opt =>
            opt.setName('tekst')
                .setDescription('Tekst do powiedzenia')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('sound')
        .setDescription('Zarządzanie poszczególnymi dźwiękami')
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Dodaje nowy dźwięk z pliku lub linku YouTube')
                .addStringOption(opt =>
                    opt.setName('kategoria')
                        .setDescription('Kategoria docelowa')
                        .setAutocomplete(true)
                        .setRequired(true))
                .addAttachmentOption(opt =>
                    opt.setName('plik')
                        .setDescription('Plik audio (.mp3 lub .wav)')
                        .setRequired(false))
                .addStringOption(opt =>
                    opt.setName('link_yt')
                        .setDescription('Link do filmu YT')
                        .setRequired(false))
                .addStringOption(opt =>
                    opt.setName('nazwa')
                        .setDescription('Wyświetlana nazwa')
                        .setRequired(false))
                .addStringOption(opt =>
                    opt.setName('start')
                        .setDescription('Start dźwięku w [s]')
                        .setRequired(false))
                .addStringOption(opt =>
                    opt.setName('end')
                        .setDescription('Koniec dźwięku w [s]')
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
                        .setRequired(false))
                .addAttachmentOption(opt =>
                    opt.setName('plik_ikony')
                        .setDescription('Załącz ikonę (.png, .jpg, .ico)')
                        .setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('stats')
                .setDescription('Wyświetla statystyki użycia bota'))
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
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('normalize')
                .setDescription('Normalizuje poziom głośności (-16 LUFS) pojedyńczego dźwięku')
                .addStringOption(opt =>
                    opt.setName('kategoria')
                        .setDescription('Kategoria (pozostaw puste, aby znormalizować WSZYSTKIE dźwięki)')
                        .setAutocomplete(true)
                        .setRequired(false))
                .addStringOption(opt =>
                    opt.setName('dzwiek')
                        .setDescription('Nazwa dźwięku (pozostaw puste, aby znormalizować CAŁĄ kategorię')
                        .setAutocomplete(true)
                        .setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('move')
                .setDescription('Przenosi dźwięk z jednej kategorii do drugiej')
                .addStringOption(opt =>
                    opt.setName('kategoria')
                        .setDescription('Obecna kategoria')
                        .setAutocomplete(true)
                        .setRequired(true))
                .addStringOption(opt =>
                    opt.setName('dzwiek')
                        .setDescription('Dźwięk do przeniesienia')
                        .setAutocomplete(true)
                        .setRequired(true))
                .addStringOption(opt =>
                    opt.setName('nowa_kategoria')
                        .setDescription('Docelowa kategoria')
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
        .addSubcommand(sub =>
            sub.setName('delete')
                .setDescription('Usuwa kategorię')
                .addStringOption(opt =>
                    opt.setName('kategoria')
                        .setDescription('Nazwa kategorii do usunięcia')
                        .setAutocomplete(true)
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('build')
                .setDescription('Buduje widok pojedyńczej kategorii')
                .addStringOption(opt =>
                    opt.setName('kategoria')
                        .setDescription('Wybierz kategorię do zbudowania')
                        .setAutocomplete(true)
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('emoji')
                .setDescription('Zmienia emoji dla tytułu kategorii')
                .addStringOption(opt =>
                    opt.setName('kategoria')
                        .setDescription('Nazwa folderu kategorii:')
                        .setAutocomplete(true)
                        .setRequired(true))
                .addStringOption(opt =>
                    opt.setName('emoji')
                        .setDescription('Emoji, które ma się pojawić przed nazwą:')
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
                            { name: '🟥 Czerwony', value: 'Danger' },
                            { name: '⬛ Szary', value: 'Secondary' }
                        ))),
    new SlashCommandBuilder()
        .setName('intro')
        .setDescription('Dźwięk po wejściu na kanał')
        .addSubcommand(sub =>
                sub.setName('set')
                    .setDescription('Ustawia dźwięk powitalny')
                    .addStringOption(opt =>
                        opt.setName('kategoria')
                            .setDescription('Kategoria')
                            .setAutocomplete(true)
                            .setRequired(true))
                    .addStringOption(opt =>
                        opt.setName('dzwiek')
                            .setDescription('Dźwięk')
                            .setAutocomplete(true)
                            .setRequired(true)))
        .addSubcommand(sub =>
                sub.setName('enable')
                    .setDescription('Włącza intro dźwięk powitalny'))
        .addSubcommand(sub =>
                sub.setName('disable')
                    .setDescription('Wyłącza intro dźwięk powitalny'))
        .addSubcommand(sub =>
                sub.setName('remove')
                    .setDescription('Usuwa dźwięk powitalny'))
].map(cmd => cmd.toJSON());

client.once('clientReady', async () => {
    console.log(`[CLIENT] Bot zalogowany jako ${client.user.tag}`);
    setupBarkaCron(client);
    await restorePanelReferences(client);
    startPanelTicker(1000);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log('[CLIENT] Komendy pomyślnie zarejestrowane.');
    } catch (error) {
        console.error('[CLIENT] Błąd rejestracji komend:', error);
    }
});

client.on('voiceStateUpdate', (oldState, newState) => {
    handleVoiceStateChange(oldState, newState);
});

client.on('interactionCreate', handleInteraction);
client.login(process.env.DISCORD_TOKEN);