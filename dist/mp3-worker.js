importScripts("./vendor/lamejs/lame.min.js");

let encoder;

function pcm16(samples) {
  const result = new Int16Array(samples.length);
  for (let i = 0; i < result.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    result[i] = Math.round(x * (x < 0 ? 32768 : 32767));
  }
  return result;
}

self.onmessage = ({ data }) => {
  try {
    if (data.type === "start") {
      encoder = new lamejs.Mp3Encoder(data.channels, data.sampleRate, data.channels === 1 ? 128 : 192);
      self.postMessage({ type: "ready" });
      return;
    }
    let bytes;
    if (data.type === "samples") {
      const left = pcm16(data.left);
      const right = data.right ? pcm16(data.right) : left;
      bytes = encoder.encodeBuffer(left, right);
    } else {
      bytes = encoder.flush();
      encoder = null;
    }
    self.postMessage({ type: data.type === "end" ? "done" : "next", bytes }, [bytes.buffer]);
  } catch {
    self.postMessage({ type: "failed" });
  }
};
