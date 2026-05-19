/// <reference types="vite/client" />

// HTMLCanvasElement.captureStream() is not in the standard TS DOM types yet
interface HTMLCanvasElement {
  captureStream(frameRequestRate?: number): MediaStream
}
