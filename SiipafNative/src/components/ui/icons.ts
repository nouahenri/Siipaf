/**
 * Pictogrammes : les chiffres clés et équipements du site sont réglés dans le dashboard avec des classes Font Awesome
 * (« fas fa-road ») ; l'application les traduit en icônes Lucide (mêmes icônes que l'espace client web).
 */
import {
  Baby, Bus, Building, CalendarDays, Car, CircleCheck, Clock, Droplets, Dumbbell, GraduationCap, HandCoins, HeartPulse, House,
  Info, Landmark, MapPin, Percent, Plug, Road, Ruler, ShieldCheck, ShoppingBag, Snowflake, Star, Trees, Utensils, Video, Wifi,
  ArrowUpDown, Church, Trophy, WavesLadder, ConciergeBell,
  type LucideIcon,
} from 'lucide-react-native';

const FA: Record<string, LucideIcon> = {
  'fa-ruler-combined': Ruler, 'fa-road': Road, 'fa-map-marker-alt': MapPin, 'fa-clock': Clock, 'fa-percentage': Percent,
  'fa-calendar-alt': CalendarDays, 'fa-hand-holding-usd': HandCoins, 'fa-home': House, 'fa-building': Building, 'fa-tree': Trees,
  'fa-shield-alt': ShieldCheck, 'fa-graduation-cap': GraduationCap, 'fa-star': Star, 'fa-info-circle': Info, 'fa-th-large': Building,
};

export const figureIcon = (cls?: string | null): LucideIcon => {
  const key = String(cls || '').split(/\s+/).find(k => k.startsWith('fa-') && FA[k]);
  return (key && FA[key]) || Info;
};

// Équipements d'après leur libellé (même table que js/offers.js du site)
const AMENITIES: [RegExp, LucideIcon][] = [
  [/piscine/i, WavesLadder], [/terrain de sport|football|stade/i, Trophy], [/sport|gym|fitness/i, Dumbbell], [/parking|garage/i, Car],
  [/ascenseur/i, ArrowUpDown], [/cctv|surveillance|vid[ée]o/i, Video], [/s[ée]curi|gardien|clôtur/i, ShieldCheck],
  [/groupe|[ée]lectrog|[ée]lectri/i, Plug], [/eau|forage|château/i, Droplets], [/clim/i, Snowflake], [/cuisine/i, Utensils],
  [/domotique|intelligent|wifi|fibre/i, Wifi], [/jeux|enfant/i, Baby], [/vert|jardin|parc/i, Trees],
  [/[ée]cole|scolaire|lyc[ée]e|crèche/i, GraduationCap], [/m[ée]dical|sant[ée]|clinique|h[ôo]pital|pharmacie/i, HeartPulse],
  [/commerc|march[ée]|boutique|shopping/i, ShoppingBag], [/concierg/i, ConciergeBell], [/pont|route|voie|acc[èe]s/i, Road],
  [/culte|mosqu[ée]e|[ée]glise/i, Church], [/banque/i, Landmark], [/transport|bus/i, Bus],
];
export const amenityIcon = (label: string): LucideIcon => AMENITIES.find(([re]) => re.test(label))?.[1] || CircleCheck;
