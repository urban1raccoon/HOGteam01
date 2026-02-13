import axios from 'axios';

const rawBaseUrl =
  process.env.EXPO_PUBLIC_API_URL ||
  'https://web-production-e7886.up.railway.app';

const baseURL = rawBaseUrl.replace(/\/+$/, '');

const api = axios.create({
  baseURL,
  timeout: 20000,
});

export default api;
