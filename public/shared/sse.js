/**
 * Server-Sent Events: an incremental parser and a serializer. Pure and isomorphic.
 * The browser uses the parser on the /api/generate stream; the server uses it on the
 * Anthropic Messages stream and the serializer for its own stream.
 * Spec: https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation
 */

/**
 * @param {(event: { event: string, data: string, id?: string }) => void} onEvent
 * @returns {{ push(text: string): void, end(): void }}
 */
export function createSSEParser(onEvent) {
  let buffer = "";
  let event = "";
  let data = [];
  let id;

  const dispatch = () => {
    if (data.length) onEvent({ event: event || "message", data: data.join("\n"), ...(id !== undefined ? { id } : {}) });
    event = "";
    data = [];
  };

  const handleLine = (rawLine) => {
    if (rawLine === "") return dispatch();
    if (rawLine.startsWith(":")) return; // comment / heartbeat
    const colon = rawLine.indexOf(":");
    const field = colon === -1 ? rawLine : rawLine.slice(0, colon);
    let value = colon === -1 ? "" : rawLine.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    else if (field === "id") id = value;
  };

  return {
    push(text) {
      buffer += text;
      let match;
      // Lines end in \n, \r\n or a lone \r.
      while ((match = /\r\n|\n|\r/.exec(buffer))) {
        if (match[0] === "\r" && match.index === buffer.length - 1) break; // maybe half of \r\n
        handleLine(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
      }
    },
    end() {
      if (buffer) handleLine(buffer.replace(/\r$/, ""));
      buffer = "";
      dispatch();
    },
  };
}

/** One SSE frame. `data` is JSON-encoded, so it never contains a raw newline. */
export function formatSSE(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
