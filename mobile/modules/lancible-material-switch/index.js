// Нативный переключатель Material 3 на Android — MaterialSwitch из android/
// рядом. Это локальный модуль Expo: автолинковка подхватывает его из
// mobile/modules при сборке APK (expo-module.config.json, только Android).
// В Expo Go, на iOS и в jest нативной части нет — тогда здесь null, и
// components/Switch.js рисует переключатель сам. Проверять надо модуль, а не
// вид: requireNativeView отдаёт компонент и без нативной части, а падает уже
// при отрисовке.
import { requireNativeView, requireOptionalNativeModule } from 'expo';

export const MaterialSwitchView = requireOptionalNativeModule('LancibleMaterialSwitch')
  ? requireNativeView('LancibleMaterialSwitch')
  : null;
