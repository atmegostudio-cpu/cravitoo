import { useEffect, useRef, useCallback, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

/**
 * useOrdersSocket - WebSocket hook for real-time order updates
 * @param {string} role - 'employee' or 'vendor'
 * @param {function} onMessage - callback for incoming messages
 */
export default function useOrdersSocket(role, onMessage) {
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);
  const [connected, setConnected] = useState(false);

  const connect = useCallback(async () => {
    try {
      const token = await SecureStore.getItemAsync('access_token');
      if (!token) return;

      const apiUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
      const wsProtocol = apiUrl.startsWith('https') ? 'wss' : 'ws';
      const wsHost = apiUrl.replace(/^https?:\/\//, '');
      const path = role === 'vendor' ? '/ws/vendor' : '/ws/orders';
      const url = `${wsProtocol}://${wsHost}${path}?token=${encodeURIComponent(token)}`;

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        // Heartbeat
        const heartbeat = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send('ping');
          else clearInterval(heartbeat);
        }, 25000);
      };

      ws.onmessage = (evt) => {
        try {
          if (evt.data === 'pong') return;
          const msg = JSON.parse(evt.data);
          if (onMessage) onMessage(msg);
        } catch (e) {
          // Ignore non-JSON
        }
      };

      ws.onclose = () => {
        setConnected(false);
        // Auto-reconnect after 5s
        if (reconnectRef.current) clearTimeout(reconnectRef.current);
        reconnectRef.current = setTimeout(connect, 5000);
      };

      ws.onerror = () => {
        setConnected(false);
      };
    } catch (e) {
      console.log('WS connect error', e?.message);
    }
  }, [role, onMessage]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect]);

  return { connected };
}
