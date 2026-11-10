const fs = require('fs');
const path = require('path');
const https = require('https');
const { 
    exec, 
    spawn 
} = require('child_process');
const { 
    SOUNDS_DIR 
} = require('../audio/playerService');
const { 
    soundDisplayNames, 
    normalizedFiles, 
    saveConfig 
} = require('../ui/uiBuilders');

function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        https.get(url, (response) => {
            if (response.statusCode !== 200) return reject(new Error(`Błąd pobierania pliku. Kod HTTP: ${response.statusCode}`));
            response.pipe(file);
            file.on('finish', () => {
                file.close(resolve);
            });
        }).on('error', (err) => {
            fs.unlink(destPath, () => { });
            reject(err);
        });
    });
}
function downloadYouTubeAudio(url, outputPath) {
    return new Promise((resolve, reject) => {
        const env = {
            ...process.env,
            PATH: `${process.env.PATH}:/usr/bin:/usr/local/bin:/root/.local/bin:/home/discord_soundboard/.local/bin`
        };
        const cookiesPath = path.join(__dirname, '../../cookies.txt');
        const cookiesFlag = fs.existsSync(cookiesPath) ? `--cookies "${cookiesPath}"` : '';
        const command = `yt-dlp --js-runtimes node ${cookiesFlag} -x --audio-format mp3 --audio-quality 0 -o "${outputPath}" "${url}"`;
        exec(command, { env }, (error, stdout, stderr) => {
            if (error) {
                const outputLog = (stderr || error.message || '').toString();
                console.error('[Donwload Error]:', outputLog);
                if (outputLog.includes('DRM protected') || outputLog.includes('DRM')) {
                    return reject(new Error('Ten utwór jest chroniony prawami autorskimi (DRM) i nie można go pobrać z podanego linku. Wgraj plik bezpośrednio z dysku (.mp3 / .wav).'));
                }
                if (outputLog.includes('Sign in to confirm your age')) {
                    return reject(new Error('Ten materiał wymaga weryfikacji wieku na YouTube.'));
                }
                return reject(new Error('Nie udało się pobrać dźwięku z podanego odnośnika. Upewnij się, że link jest poprawny/film w 100% publiczny'));
            }
            resolve(true);
        });
    });
}
function getYoutubeTitle(url) {
    return new Promise((resolve) => {
        const env = {
            ...process.env,
            PATH: `${process.env.PATH}:/usr/bin:/usr/local/bin:/root/.local/bin:/home/discord_soundboard/.local/bin`
        };
        const cookiesPath = path.join(__dirname, '../../cookies.txt');
        const cookiesFlag = fs.existsSync(cookiesPath) ? `--cookies "${cookiesPath}"` : '';
        const command = `yt-dlp --js-runtimes node ${cookiesFlag} --get-title "${url}"`;
        exec(command, { env }, (error, stdout) => {
            if (error || !stdout.trim()) {
                console.error('[YouTube Title Fetch Error]:', error ? error.message : 'Pusty tytuł');
                return resolve(null);
            }
            resolve(stdout.trim().split('\n')[0]);
        });
    });
}

async function normalizeSingleFile(filePath) {
    const relativePath = path.relative(SOUNDS_DIR, filePath);
    const soundKey = relativePath.replace(/\\/g, '/');
    if (typeof normalizedFiles !== 'undefined' && normalizedFiles.has(soundKey)) {
        console.log(`[Normalizacja] Plik jest już znormalizowany: ${soundKey}`);
        return false;
    }
    return new Promise((resolve, reject) => {
        const ext = path.extname(filePath).replace('.', '');
        const command = `ffmpeg-normalize "${filePath}" -ext ${ext} -c:a libmp3lame -b:a 192k -nt ebu --target-level=-16 -f`;
        const env = {
            ...process.env,
            PATH: `${process.env.PATH}:/root/.local/bin:/home/discord_soundboard/.local/bin:/usr/local/bin`
        };
        exec(command, { env }, (error, stdout, stderr) => {
            if (error) {
                console.error(`[Normalizacja] Błąd dla ${filePath}:`, stderr || error.message);
                return reject(new Error(stderr || error.message));
            }
            normalizedFiles.add(soundKey);
            if (typeof saveConfig === 'function') saveConfig();
            console.log(`[Normalizacja] Pomyślnie znormalizowano plik: ${filePath}`);
            resolve(true);
        });
    });
}
function normalizeMultipleFiles(filePath) {
    return new Promise((resolve, reject) => {
        if (!filePath || filePath.length === 0) return resolve(0);
        const env = {
            ...process.env,
            PATH: `${process.env.PATH}:/usr/bin:/usr/local/bin:/root/.local/bin:/home/discord_soundboard/.local/bin`
        };
        const escapedPaths = filePath.map(p => `"${p}"`).join(' ');
        const command = `ffmpeg-normalize ${escapedPaths} -ext mp3 -c:a libmp3lame -b:a 192k -nt ebu -t -16 -f`;
        exec(command, { env }, (error, stdout, stderr) => {
            if (error) {
                console.error('[Normalizacja ERROR]:', stderr || error.message);
                return reject(new Error(stderr || error.message));
            }
            resolve(filePath.length);
        });
    });
}

function findAudioFile(category, inputName) {
    if (!category || !inputName) return null;
    const targetDir = path.join(SOUNDS_DIR, category);
    if (!fs.existsSync(targetDir)) return null;
    const files = fs.readdirSync(targetDir).filter(f => f.endsWith('.mp3') || f.endsWith('.wav'));
    const search = inputName.trim().toLowerCase();
    return files.find(file => {
        const soundKey = `${category}/${file}`;
        const displayName = typeof soundDisplayNames !== 'undefined' ? soundDisplayNames[soundKey] : null;
        const fileNameWithoutExt = path.parse(file).name;
        return (displayName && displayName.toLowerCase() === search) ||
            fileNameWithoutExt.toLowerCase() === search ||
            file.toLowerCase() === search;
    }) || null;
}

function clearFolderName(rawName) {
    return rawName
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '');
}

function clearFileName(customNameInput, attachmentName, extension) {
    if (customNameInput && customNameInput.trim()) {
        const safeName = customNameInput.trim().replace(/[\\/:*?"<>|]/g, '');
        return `${safeName}${extension}`;
    }
    if (attachmentName) return path.parse(attachmentName).name + extension;
    return `audo_${Date.now()}${extension}`;
}

function parseTimestamp(input) {
    if (!input) return null;
    const cleanStr = String(input).trim();
    if (!isNaN(cleanStr)) {
        return cleanStr;
    }
    const parts = cleanStr.split(':');
    if (parts.length === 2) {
        const minutes = parseInt(parts[0], 10);
        const seconds = parseFloat(parts[1]);
        if (!isNaN(minutes) && !isNaN(seconds)) {
            return String(minutes * 60 + seconds);
        }
    } else if (parts.length === 3) {
        const hours = parseInt(parts[0], 10);
        const minutes = parseInt(parts[1], 10);
        const seconds = parseFloat(parts[2]);
        if (!isNaN(hours) && !isNaN(minutes) && !isNaN(seconds)) {
            return String(hours * 3600 + minutes * 60 + seconds);
        }
    }
    return null;
}

function trimAudioFile(inputPath, outputPath, startTime, endTime) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(inputPath))
            return reject(new Error(`Plik wejściowy do przycięcia nie istnieje pod ścieżką: ${inputPath}`));
        const args = ['-y', '-loglevel', 'error', '-i', inputPath];
        if (startTime !== null && startTime !== undefined && String(startTime).trim() !== '') args.push('-ss', String(startTime));
        if (endTime !== null && endTime !== undefined && String(endTime).trim() !== '') args.push('-to', String(endTime));
        args.push(
            '-vn', '-sn', '-dn',
            '-acodec', 'libmp3lame',
            '-b:a', '192k',
            outputPath
        );
        const ffmpegProcess = spawn('ffmpeg', args);
        let stderrData = '';
        if (ffmpegProcess.stderr) {
            ffmpegProcess.stderr.on('data', (chunk) => {
                stderrData += chunk.toString();
            });
        }
        ffmpegProcess.on('close', (code) => {
            if (code === 0) {
                resolve(true);
            } else {
                console.error(`[FFmpeg Trim Error Output]: ${stderrData}`);
                reject(new Error(`FFmpeg zakończył działanie z kodem błędu ${code}: ${stderrData || 'Brak treści błędu'}`));
            }
        });
        ffmpegProcess.on('error', (err) => reject(err));
    });
}

module.exports = {
    downloadFile,
    downloadYouTubeAudio,
    getYoutubeTitle,
    normalizeSingleFile,
    normalizeMultipleFiles,
    findAudioFile,
    clearFolderName,
    clearFileName,
    parseTimestamp,
    trimAudioFile
};