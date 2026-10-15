import axios from 'axios';

const backend = (process.env.REACT_APP_BACKEND_URL || '').replace(/\/$/, '');
export const mobileApi = axios.create({ baseURL: `${backend}/api`, withCredentials: true });
const TOKEN_KEY = 'mds_mobile_viewer_session';

mobileApi.interceptors.request.use((config) => {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const saveMobileToken = (token) => sessionStorage.setItem(TOKEN_KEY, token);
export const clearMobileToken = () => sessionStorage.removeItem(TOKEN_KEY);
