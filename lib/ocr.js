'use strict';

const Tesseract = require('tesseract.js');

// Tesseract workers are expensive to spin up (~0.5-1s) — reuse one across
// requests instead of creating a new one per image.
let workerPromise = null;
function getWorker() {
  if (!workerPromise) {
    // IMPORTANT: tesseract.js's worker message handler unconditionally
    // re-throws inside its internal 'message' callback whenever a job
    // rejects *unless* an errorHandler is supplied — without this, a
    // corrupt/invalid image crashes the entire Node process with an
    // uncaught exception, even though recognize() also (correctly)
    // rejects its promise. The errorHandler below absorbs that duplicate
    // throw; the promise rejection is what we actually act on below.
    workerPromise = Tesseract.createWorker('eng', undefined, {
      errorHandler: () => { /* swallowed — see comment above */ }
    }).catch(err => {
      workerPromise = null; // let the next call retry instead of being stuck on a failed worker forever
      throw err;
    });
  }
  return workerPromise;
}

// Extracts raw text from an image buffer. Never throws — a bad/corrupt
// image or an OCR engine hiccup should degrade to "no text found", not
// take down the request.
async function extractTextFromImage(buffer) {
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(buffer);
    return data.text || '';
  } catch {
    return '';
  }
}

async function shutdownOCR() {
  if (workerPromise) {
    try {
      const worker = await workerPromise;
      await worker.terminate();
    } catch { /* already gone, fine */ }
    workerPromise = null;
  }
}

module.exports = { extractTextFromImage, shutdownOCR };
