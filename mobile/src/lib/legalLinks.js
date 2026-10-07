// Ссылки на лендинг: главная, блог и правовые документы. Адрес — один на всё
// приложение, тот же, что у десктопа; документы открываются на языке
// приложения (core/legal.js добавляет ?lang=).
import { Linking } from 'react-native';
import Legal from '../core/legal.js';

export const LANDING_URL = 'https://lancible.vercel.app';

export function openLegal(doc, lang) {
  return Linking.openURL(Legal.legalUrl(LANDING_URL, doc, lang));
}
