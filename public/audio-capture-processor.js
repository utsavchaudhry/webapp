class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._bufferSize = 2048
    this._buffer = new Float32Array(this._bufferSize)
    this._offset = 0
  }

  process(inputs) {
    const input = inputs[0]
    if (input.length === 0 || input[0].length === 0) return true

    const samples = input[0]
    let pos = 0

    while (pos < samples.length) {
      const remaining = this._bufferSize - this._offset
      const toCopy = Math.min(remaining, samples.length - pos)
      this._buffer.set(samples.subarray(pos, pos + toCopy), this._offset)
      this._offset += toCopy
      pos += toCopy

      if (this._offset >= this._bufferSize) {
        const int16 = new Int16Array(this._bufferSize)
        for (let i = 0; i < this._bufferSize; i++) {
          const s = Math.max(-1, Math.min(1, this._buffer[i]))
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
        }
        this.port.postMessage(int16.buffer, [int16.buffer])
        this._offset = 0
      }
    }

    return true
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor)
