const fs = require('fs');
const path = require('path');
const { findCategory } = require('../handlers/categoryHandler');
const { findAudioFile } = require('../utils/audioUtils');
const INTROS_FILE = path.join(__dirname, '../../config/userIntros.json');

function getUserIntros() {
    try {
        if (fs.existsSync(INTROS_FILE)) {
            const data = fs.readFileSync(INTROS_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('[CONFIG INTRO] Błąd odczytu userIntros.json', error);
    }
    return {};
}

function setUserIntro(userId, categoryInput, soundInput) {
    const intros = getUserIntros();
    const matchedCategory = typeof findCategory === 'function'
        ? (findCategory(categoryInput) || categoryInput)
        : categoryInput;
    const matchedFile = typeof findAudioFile === 'function'
        ? (findAudioFile(matchedCategory, soundInput) || soundInput)
        : soundInput;
    intros[userId] = { 
        category : matchedCategory, 
        fileName : matchedFile,
        enabled: true
    };
    const dir = path.dirname(INTROS_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(INTROS_FILE, JSON.stringify(intros, null, 2), 'utf8');
}

function setUserIntroStatus(userId, enabledStatus) {
    const intros = getUserIntros();
    if (!intros[userId]) return false;
    intros[userId].enabled = enabledStatus;
    fs.writeFileSync(INTROS_FILE, JSON.stringify(intros, null, 2), 'utf8');
    return true;
}

function removeUserIntro(userId) {
    const intros = getUserIntros();
    if (intros[userId]) {
        delete intros[userId];
        fs.writeFileSync(INTROS_FILE, JSON.stringify(intros, null, 2), 'utf8');
        return true;
    }
    return false;
}

module.exports = {
    getUserIntros,
    setUserIntro,
    setUserIntroStatus,
    removeUserIntro
};