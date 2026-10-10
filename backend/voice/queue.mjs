// Bounded queue bridges browser WebSocket messages to AWS's async audio iterator.
export function audioQueue(maxBytes = 192000) {
  const items = []; let size = 0, ended = false, wake;
  return {
    push(chunk) {
      if (ended) return;
      if (size + chunk.length > maxBytes) throw new Error('Audio connection is too slow. Stop and try again.');
      items.push(chunk); size += chunk.length; wake?.();
    },
    end() { ended = true; wake?.(); },
    async *[Symbol.asyncIterator]() {
      while (true) {
        if (items.length) { const chunk = items.shift(); size -= chunk.length; yield {AudioEvent: {AudioChunk: chunk}}; }
        else if (ended) return;
        else await new Promise(resolve => { wake = resolve; });
      }
    }
  };
}
