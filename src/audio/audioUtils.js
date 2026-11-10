// ** Holds track duration cache and ffprobe callouts ** //
const { execFile, exec } = require('child_process');
const path = require('path');
const durationCache = new Map();

function getDurationMs(filePath) {
    if (durationCache.has(filePath)) return Promise.resolve(durationCache.get(filePath));
    return new Promise(resolve => {
        execFile('ffprobe', [
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=nw=1:nk=1',
            filePath
        ], (err, stdout) => {
            const sec = parseFloat(stdout);
            const ms = !err && Number.isFinite(sec) ? Math.round(sec * 1000) : 0;
            if (ms > 0) durationCache.set(filePath, ms);
            resolve(ms);
        });
    });
}

function getYouTubeDurationMs(url) {
    return new Promise((resolve) => {
        const env = {
            ...process.env,
            PATH: `${process.env.PATH}:/usr/bin:/usr/local/bin:/root/.local/bin:/home/discord_soundboard/.local/bin`
        };
        const cookiesPath = path.join(__dirname, '../../cookies.txt');
        const cookiesFlag = fs.existsSync(cookiesPath) ? `--cookies "${cookiesPath}"` : '';
        const command = `yt-dlp --js-runtimes node ${cookiesFlag} --print "%(duration)s" "${url}"`;
        exec(command, { env }, (error, stdout) => {
            if (error || !stdout || !stdout.trim()) {
                return resolve(0);
            }
            const seconds = parseFloat(stdout.trim());
            const ms = !isNaN(seconds) ? Math.round(seconds * 1000) : 0;
            resolve(ms);
        });
    });
}

module.exports = {
    durationCache,
    getDurationMs,
    getYouTubeDurationMs,
};