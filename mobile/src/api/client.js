import axios from 'axios';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

const API_URL = Constants.expoConfig?.extra?.apiUrl || 'https://corporate-feast.preview.emergentagent.com';

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
