/** Retours haptiques de l'application, coupés quand l'utilisateur les désactive dans Paramètres. */
import * as H from 'expo-haptics';
import { getPrefs } from './prefs';

export const ImpactFeedbackStyle = H.ImpactFeedbackStyle;
export const NotificationFeedbackType = H.NotificationFeedbackType;

const on = () => getPrefs().haptics;
export const selectionAsync = () => (on() ? H.selectionAsync() : Promise.resolve());
export const impactAsync = (style?: H.ImpactFeedbackStyle) => (on() ? H.impactAsync(style) : Promise.resolve());
export const notificationAsync = (type?: H.NotificationFeedbackType) => (on() ? H.notificationAsync(type) : Promise.resolve());
