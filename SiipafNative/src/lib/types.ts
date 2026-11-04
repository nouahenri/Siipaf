/** Formes des réponses de l'API (routes public.js, client.js, clientSav.js du serveur). */

export type Figure = { icon: string; value: string; label: string };
export type Offer = { id?: number; label?: string | null; designation?: string | null; surface?: string | null; price_fcfa?: number | null; diaspora_price_fcfa?: number | null; badge?: string | null; highlights?: string | null };
export type DocState = { label: string; state?: string | null; state_label?: string | null };

export type Project = {
  id: number; slug: string; name: string; city?: string | null; location?: string | null; tagline?: string | null; description?: string | null;
  city_id?: number | null; location_id?: number | null; property_type_ids?: number[];
  amenities: string[]; project_type?: string | null; key_figures: Figure[]; property_types: string[]; offers: Offer[];
  category?: string | null; delivery?: string | null; cover?: string | null; geo?: { lat: number; lng: number } | null;
  lots: Record<string, number>; has_plan?: boolean; deposit_fcfa: number; balance_months: number; balance_months_choices?: number[];
  documents: DocState[];
};

export type PlanLot = { id: number; plan_id: number; offer_id?: number | null; code: string; ilot?: string | null; surface_m2?: number | null; price_fcfa?: number | null; status: string; shape: [number, number][] | null; sellable: boolean };
export type SitePlan = { id: number; name: string; image: string | null; width: number; height: number; lots: PlanLot[] };
export type ProjectDetail = Project & {
  commodites: string[]; viabilisation: DocState[]; option_days: number; statuses: Record<string, string>; plans: SitePlan[];
  /** Image principale puis galerie du dashboard. */
  gallery?: { id: number; url: string; alt?: string | null }[];
};

export type HeroSlide = { media_id?: number | null; badge?: string; title?: string; title_em?: string; text?: string; cta_label?: string; cta_href?: string; cta2_label?: string; cta2_href?: string; active?: boolean };
export type SiteContent = {
  hero?: { slides?: HeroSlide[]; autoplay_ms?: number };
  site?: { phone?: string; phone2?: string; email?: string; address?: string; whatsapp?: string; socials?: Record<string, string> };
  ticker?: { items?: { text: string; href?: string }[] };
  stats?: { items?: { value: number | string; unit?: string; label: string }[] };
  editorial?: { texts?: Record<string, unknown>; hidden?: string[] };
  images?: Record<string, { url: string; alt?: string }>;
};

export type Testimonial = { id: number; name: string; role_label?: string | null; rating?: number | null; message: string; photo_url?: string | null; project_name?: string | null };
export type Job = { id: number; title: string; department?: string | null; department_label?: string | null; contract_type?: string; contract_label?: string; location?: string | null; description?: string | null; closing_date?: string | null; openings?: number | null };

/* ─── Espace client ─── */

export type ClientProfile = {
  client_code: string; name: string; email?: string | null; phone?: string | null; country?: string | null;
  property_type?: string | null; project_name?: string | null; progress?: { progress_pct: number; stage_label?: string } | null;
  must_change_password: boolean; unread_messages: number; push_prefs?: Record<string, boolean>;
};

export type Property = { lot_code: string; ilot?: string | null; type?: string | null; surface_m2?: number | null; project: { id: number; name: string; slug: string; city?: string | null; location?: string | null; delivery?: string | null; cover_url?: string | null } };
export type Installment = { id?: number; seq: number; label: string; kind?: string; due_date: string; amount_fcfa: number; paid_fcfa: number; remaining_fcfa: number; status: string };
export type Payment = { id: number; amount_fcfa: number; paid_at: string; method: string; reference?: string | null; receipt_number: string };
export type SaleDocument = { id: number; label: string; status: string; note?: string | null; updated_at?: string | null; download_url?: string | null };
export type Change = { id: number; reference: string; title: string; status: string; status_label?: string; amount_fcfa?: number | null; delay_days?: number | null; due_date?: string | null; quote_note?: string | null; can_answer?: boolean };
export type Delivery = { handover?: { handed_on: string; client_signed?: boolean; pv_url?: string | null } | null; reserves: { id: number; label: string; location?: string | null; category_label?: string | null; deadline?: string | null; status: string }[] };

export type Dossier = {
  id: number; status: string; property: Property; price_fcfa: number; paid_fcfa: number; remaining_fcfa: number; percent_paid: number;
  overdue_count: number; overdue_fcfa: number; next_due?: Installment | null; progress?: { progress_pct: number; stage_label?: string } | null;
  financing_label?: string | null;
};
export type DossierDetail = Dossier & {
  schedule: Installment[]; payments: Payment[]; documents: SaleDocument[];
  /** Paiements déclarés depuis l'application : en vérification par la Comptabilité, ou refusés. */
  declarations?: { id: number; amount_fcfa: number; paid_at: string; channel?: string | null; reference?: string | null; status: 'a_confirmer' | 'rejete'; reject_reason?: string | null; schedule_id?: number | null }[]; vefa_upcoming?: { seq: number; label: string; pct: number; amount_fcfa: number }[];
  changes?: Change[]; can_request_changes?: boolean; delivery?: Delivery | null;
};

export type Media = { id: number; url: string; mime?: string; alt?: string | null; kind: 'image' | 'video' };
export type SiteUpdate = { id: number; stage: string; stage_label: string; scope: string; ilot?: string | null; title: string; body?: string | null; progress_pct: number; published_at: string; media: Media[] };
export type Chantier = { property: Property; stages: { id: string; label: string }[]; updates: SiteUpdate[] };

export type Message = { id: number; sender: 'client' | 'equipe'; body: string; sale_id?: number | null; created_at: string; author?: string | null; read: boolean };

export type SavFile = { id: number; url: string; mime?: string };
export type SavTicket = {
  id: number; ref: string; title: string; status: string; created_at: string; lot_code?: string | null; category?: string; description?: string | null;
  media: SavFile[]; satisfaction?: number | null;
  events: { id: number; kind: string; author?: string; user_name?: string | null; body: string; created_at: string; media?: SavFile[] }[];
  interventions: { id: number; status: string; scheduled_at: string; duration_min?: number; media_after: SavFile[] }[];
};

/** Filtres de la recherche (GET /api/public/filtres), tirés des listes de Paramètres et de la grille de prix. */
export type FilterOption = { id: number; label: string; count: number };
export type Filters = {
  categories: { logement: number; lotissement: number };
  villes: FilterOption[];
  localisations: (FilterOption & { ville_id: number | null })[];
  types_bien: FilterOption[];
  budgets: { key: string; min: number; max: number | null; label: string; count: number }[];
};
