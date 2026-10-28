// Used to mix PCM frames in real-time
const { Readable } = require('stream');
class AudioMixer extends Readable {
    constructor() {
        super({ highWaterMark: 3840 * 4 });
        this.tracks = new Map();
    }
    addTrack(id, stream) {
        const trackState = { 
            id, 
            stream, 
            buffer: Buffer.alloc(0), 
            ended: false
        };
        stream.on('data', chunk => {
            trackState.buffer = Buffer.concat([trackState.buffer, chunk]);
        });
        stream.on('end', () => {
             trackState.ended = true;
        });
        stream.on('error', () => {
             trackState.ended = true;
        });
        this.tracks.set(id, trackState);
    }
    removeTrack(id) {
        const track = this.tracks.get(id);
        if (track) {
            if (track.stream && typeof track.stream.destroy === 'function') {
                track.stream.destroy();
            }
            this.tracks.delete(id);
        }
    }
    clear() {
        for (const [id, track] of this.tracks.entries()) {
            if (track.stream && typeof track.stream.destroy == 'function') {
                track.stream.destroy();
            }
        }
        this.tracks.clear();
    }
    _read() {
        const FRAME_SIZE = 3840;
        const mixed = Buffer.alloc(FRAME_SIZE);
        if (this.tracks.size > 0) {
            const sampleCount = FRAME_SIZE / 2;
            const sampleSums = new Int32Array(sampleCount);
            for (const [id, track] of Array.from(this.tracks.entries())) {
                if (track.buffer.length >= FRAME_SIZE) {
                    const chunk = track.buffer.subarray(0, FRAME_SIZE);
                    track.buffer = track.buffer.subarray(FRAME_SIZE);
                    for (let i = 0; i < sampleCount; i++) {
                        sampleSums[i] += chunk.readInt16LE(i * 2);
                    }
                } 
                else if (track.buffer.length > 0) {
                    const availableSamples = Math.floor(track.buffer.length / 2);
                    for (let i = 0; i < availableSamples; i++) {
                        sampleSums[i] += track.buffer.readInt16LE(i*2);
                    }
                    track.buffer = track.buffer.subarray(availableSamples * 2);
                    if (track.ended && track.buffer.length === 0) {
                        this.tracks.delete(id);
                        if (typeof this.onTrackEnd === 'function') this.onTrackEnd(id);
                    }
                }
                else if (track.ended) {
                    this.tracks.delete(id);
                    if (typeof this.onTrackEnd === 'function') this.onTrackEnd(id);
                }
            }
            for (let i = 0; i < sampleCount; i++) {
                let val = sampleSums[i];
                if (val > 32767) val = 32767;
                if (val < -32768) val = -32768;
                mixed.writeInt16LE(val, i * 2);
            }
        }
        this.push(mixed);
    }
}

module.exports = AudioMixer;