// The WebSocket to the 1v1 server (backend/versus.py). It only moves messages; App decides what
// they mean. See versus.py for the list of messages each way.
import { API_URL, getToken } from './api.js';

function socketUrl(token) {
  const base = API_URL.startsWith('http')
    ? API_URL.replace(/^http/, 'ws')
    : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${API_URL}`;
  return `${base}/versus/ws?token=${encodeURIComponent(token)}`;
}

export class VersusClient {
  // onMessage(message) for everything the server says; onClose() when the connection ends.
  constructor({ onMessage, onClose }) {
    this.onMessage = onMessage;
    this.onClose = onClose;
    this.socket = null;
    this.closedByUs = false;
  }

  connect() {
    const token = getToken();
    if (!token) {
      this.onClose?.();
      return;
    }
    this.closedByUs = false;
    const socket = new WebSocket(socketUrl(token));
    this.socket = socket;
    socket.onmessage = (event) => {
      try {
        this.onMessage(JSON.parse(event.data));
      } catch (error) {
        console.error('Bad message from the 1v1 server.', error);
      }
    };
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      if (!this.closedByUs) this.onClose?.();
    };
  }

  get open() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  send(message) {
    if (!this.open) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  close() {
    this.closedByUs = true;
    this.socket?.close();
    this.socket = null;
  }
}
