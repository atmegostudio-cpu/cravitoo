import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

const client = axios.create({
  baseURL: `${API_URL}/api`,
  timeout: 30000,
});

// Attach Bearer token to every request
client.interceptors.request.use(async (config) => {
  try {
    const token = await SecureStore.getItemAsync('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch (e) {
    // Ignore if SecureStore not yet available
  }
  return config;
});

export default client;
export { API_URL };
