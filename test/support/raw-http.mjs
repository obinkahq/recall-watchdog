// Raw HTTP/1.1 request over a loopback socket. The header names and values
// go out exactly as given (fetch adds, merges or forbids some of them).
import net from 'node:net';

function parse(text) {
  const head = text.split('\r\n\r\n')[0];
  const lines = head.split('\r\n');
  const headers = {};
  for (const line of lines.slice(1)) {
    const at = line.indexOf(':');
    if (at > 0) headers[line.slice(0, at).toLowerCase()] = line.slice(at + 1).trim();
  }
  return { status: Number(lines[0].split(' ')[1]), headers, body: text.slice(head.length + 4) };
}

// headers: [name, value] pairs. body: text. declaredLength: a Content-Length
// to send instead of the real one. chunked: send the body in chunks.
export function rawRequest(port, { method = 'GET', path = '/', headers = [], body = '', http10 = false, declaredLength = null, chunked = false } = {}) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    const data = [];
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      const text = Buffer.concat(data).toString('latin1');
      resolve(text === '' ? { status: 0, error: error ?? 'closed', headers: {}, body: '' } : parse(text));
    };
    const timer = setTimeout(() => finish('timeout'), 10_000);
    socket.on('data', (chunk) => data.push(chunk));
    socket.on('error', (error) => finish(error.code ?? 'error'));
    socket.on('close', () => finish(null));
    socket.on('connect', () => {
      let head = `${method} ${path} ${http10 ? 'HTTP/1.0' : 'HTTP/1.1'}\r\n`;
      for (const [name, value] of headers) head += `${name}: ${value}\r\n`;
      if (chunked) head += 'Transfer-Encoding: chunked\r\n';
      else if (declaredLength !== null) head += `Content-Length: ${declaredLength}\r\n`;
      else if (body !== '') head += `Content-Length: ${Buffer.byteLength(body)}\r\n`;
      socket.write(`${head}Connection: close\r\n\r\n`);
      if (chunked) {
        for (let at = 0; at < body.length; at += 8192) {
          const part = body.slice(at, at + 8192);
          socket.write(`${Buffer.byteLength(part).toString(16)}\r\n${part}\r\n`);
        }
        socket.write('0\r\n\r\n');
      } else if (body !== '') {
        socket.write(body);
      }
    });
  });
}
