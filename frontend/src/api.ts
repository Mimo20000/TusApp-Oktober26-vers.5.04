import { storage } from "@/src/utils/storage";

const BASE = "https://tusapp-oktober26-vers-5-03.onrender.com/api";
const TOKEN_KEY = "tus.token";
const PUBLIC_PATHS = new Set(["/holidays", "/league-table", "/"]);

export type Player = {
  id: string;
  name: string;
  position?: string | null;
  status: string;
  jersey_number?: number | null;
  email?: string | null;
  birthdate?: string | null;
  avatar_file_id?: string | null;
  spieler_id?: string | null;
  has_password?: boolean;
};

export type Attachment = {
  file_id: string;
  mime: string;
  filename: string;
  kind: "image" | "file";
};

export type TeamEvent = {
  id: string;
  type: "Spiel" | "Training" | "Treffen";
  date: string;
  time: string;
  home?: string | null;
  away?: string | null;
  opponent?: string | null;
  location?: string | null;
  title: string;
  cancelled?: boolean;
};

export type Attendance = { event_id: string; player_id: string; status: string; reason?: string | null; driving?: boolean; beer?: boolean };

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const isAuthPath = /\/players\/[^/]+\/(login|set-password|forgot-password|reset-password)$/.test(
    path
  );
  const skipAuth = isAuthPath || PUBLIC_PATHS.has(path);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string> | undefined),
  };
  if (!skipAuth) {
    try {
      const token = await storage.secureGet<string | null>(TOKEN_KEY, null);
      if (token) headers["Authorization"] = `Bearer ${token}`;
    } catch {
      // storage failure: proceed without token, server will 401
    }
  }
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (res.status === 401 && !skipAuth) {
    // Session expired or missing — drop the token so the app falls back to login.
    try {
      await storage.secureRemove(TOKEN_KEY);
      await storage.removeItem("tus.currentPlayerId");
      await storage.removeItem("tus.currentPlayer");
    } catch {}
  }
  if (!res.ok) {
    let detail: string | undefined;
    try {
      const body = await res.clone().json();
      if (body && typeof body.detail === "string") detail = body.detail;
    } catch {
      // non-JSON body — ignore
    }
    const err = new Error(detail || `API ${res.status}`) as Error & {
      status: number;
      detail?: string;
    };
    err.status = res.status;
    if (detail) err.detail = detail;
    throw err;
  }
  return res.json();
}

export const api = {
  players: () => req<Player[]>("/players"),
  me: () => req<Player>("/players/me"),
  events: () => req<TeamEvent[]>("/events"),
  attendance: () => req<Attendance[]>("/attendance"),
  stats: (scope?: "all" | "season") =>
    req<StatsResponse>(scope ? `/stats?scope=${scope}` : "/stats"),
  rsvp: (event_id: string, player_id: string, status: "zugesagt" | "abgesagt", reason?: string) =>
    req<{ ok: boolean; reason?: string | null }>("/rsvp", {
      method: "POST",
      body: JSON.stringify({ event_id, player_id, status, reason: reason ?? null }),
    }),
  rsvpReset: (event_id: string, player_id: string) =>
    req<{ ok: boolean }>("/rsvp/reset", {
      method: "POST",
      body: JSON.stringify({ event_id, player_id }),
    }),
  coachSetAttendance: (
    event_id: string,
    player_id: string,
    status: "zugesagt" | "abgesagt" | null,
    reason?: string | null
  ) =>
    req<{ ok: boolean }>("/attendance/coach-set", {
      method: "POST",
      body: JSON.stringify({ event_id, player_id, status, reason: reason ?? null }),
    }),
  setDriving: (event_id: string, player_id: string, driving: boolean) =>
    req<{ ok: boolean }>("/driving", {
      method: "POST",
      body: JSON.stringify({ event_id, player_id, driving }),
    }),
  setBeer: (event_id: string, player_id: string, beer: boolean) =>
    req<{ ok: boolean }>("/beer", {
      method: "POST",
      body: JSON.stringify({ event_id, player_id, beer }),
    }),
  updateStatus: (player_id: string, status: "Aktiv" | "Verletzt" | "Inaktiv") =>
    req<{ ok: boolean }>(`/players/${player_id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  updateContact: (player_id: string, body: { email?: string | null; birthdate?: string | null; jersey_number?: number | null; avatar_file_id?: string | null; spieler_id?: string | null }) =>
    req<{ ok: boolean }>(`/players/${player_id}/contact`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  createPlayer: (body: { name: string; position?: string | null; status?: string }) =>
    req<Player>("/players", { method: "POST", body: JSON.stringify(body) }),
  updatePlayer: (player_id: string, body: { name?: string; position?: string | null }) =>
    req<{ ok: boolean }>(`/players/${player_id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deletePlayer: (player_id: string) =>
    req<{ ok: boolean }>(`/players/${player_id}`, { method: "DELETE" }),
  createEvent: (body: {
    type: "Spiel" | "Training" | "Treffen";
    date: string;
    time: string;
    opponent?: string;
    location?: string;
    home_game?: boolean;
  }) =>
    req<TeamEvent>("/events", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateEvent: (
    event_id: string,
    body: {
      type?: "Spiel" | "Training" | "Treffen";
      date?: string;
      time?: string;
      location?: string | null;
      opponent?: string;
      home_game?: boolean;
    }
  ) =>
    req<{ ok: boolean }>(`/events/${event_id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  cancelEvent: (event_id: string) =>
    req<{ ok: boolean }>(`/events/${event_id}/cancel`, { method: "POST" }),
  eventOverview: (event_id: string) =>
    req<EventOverview>(`/events/${event_id}/overview`),
  holidays: () => req<Holiday[]>("/holidays"),
  leagueTable: () => req<LeagueTable>("/league-table"),
  bwhvTeams: () => req<BwhvTeamsResponse>("/bwhv/teams"),
  bwhvClass: (classId: string) => req<BwhvClass>(`/bwhv/class/${encodeURIComponent(classId)}`),
  getCarpool: (eventId: string) =>
    req<{ event_id: string; seats: Record<string, number>; assignments: Record<string, string> }>(
      `/carpool/${encodeURIComponent(eventId)}`
    ),
  saveCarpool: (eventId: string, seats: Record<string, number>, assignments: Record<string, string>) =>
    req<{ event_id: string; seats: Record<string, number>; assignments: Record<string, string> }>(
      `/carpool/${encodeURIComponent(eventId)}`,
      { method: "PUT", body: JSON.stringify({ seats, assignments }) }
    ),
  getBierwart: () => req<{ email: string }>("/settings/bierwart"),
  setBierwart: (email: string) =>
    req<{ ok: boolean; email: string }>("/settings/bierwart", {
      method: "PATCH",
      body: JSON.stringify({ email }),
    }),
  cashboxes: () => req<Cashbox[]>("/cashboxes"),
  updateCashbox: (
    key: string,
    body: { email?: string; recipient_player_id?: string; label?: string }
  ) =>
    req<Cashbox>(`/cashboxes/${key}`, { method: "PATCH", body: JSON.stringify(body) }),
  logPayment: (body: {
    cashbox_key: string;
    amount?: number;
    note?: string;
    event_id?: string;
    payer_id?: string;
  }) => req<Payment>("/payments", { method: "POST", body: JSON.stringify(body) }),
  setPaymentStatus: (id: string, status: "open" | "completed") =>
    req<Payment>(`/payments/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  deletePayment: (id: string) =>
    req<{ ok: boolean }>(`/payments/${id}`, { method: "DELETE" }),
  settleMonth: (month: string, cashbox_key?: string) =>
    req<{ ok: boolean; count: number; total: number; month_label?: string }>(
      "/payments/settle-month",
      { method: "POST", body: JSON.stringify({ month, cashbox_key: cashbox_key ?? null }) }
    ),
  myOpenPayments: () =>
    req<{ by_cashbox: { cashbox_key: string; total: number; count: number }[]; total: number }>(
      "/payments/my-open"
    ),
  listPayments: () =>
    req<{
      payments: Payment[];
      sums: PaymentSum[];
      monthly_open: MonthlyOpen[];
      per_player_open: PerPlayerOpen[];
      manageable_cashboxes: string[];
      totals: PaymentTotals;
    }>("/payments"),
  messages: (conversation_id: string) =>
    req<ChatMessage[]>(`/messages?conversation_id=${encodeURIComponent(conversation_id)}`),
  sendMessage: (
    conversation_id: string,
    scope: "team" | "direct",
    sender_id: string,
    text: string,
    attachment?: Attachment | null
  ) =>
    req<ChatMessage>("/messages", {
      method: "POST",
      body: JSON.stringify({ conversation_id, scope, sender_id, text, attachment: attachment ?? null }),
    }),
  markRead: (player_id: string, conversation_id: string) =>
    req<{ ok: boolean }>("/messages/read", {
      method: "POST",
      body: JSON.stringify({ player_id, conversation_id }),
    }),
  voteSekt: (message_id: string) =>
    req<{ ok: boolean; voters: string[]; count: number }>(
      `/messages/${encodeURIComponent(message_id)}/vote-sekt`,
      { method: "POST" }
    ),
  conversations: () => req<Conversations>("/conversations"),
  unread: () => req<{ total: number }>("/unread"),
  eventsUnread: () => req<{ total: number }>("/events-unread"),
  eventsSeen: () => req<{ ok: boolean }>("/events-seen", { method: "POST" }),
  registerPush: (token: string) =>
    req<{ ok: boolean }>("/push/register", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  setPassword: (player_id: string, password: string) =>
    req<AuthResponse>(`/players/${player_id}/set-password`, {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  passwordLogin: (player_id: string, password: string) =>
    req<AuthResponse>(`/players/${player_id}/login`, {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  forgotPassword: (player_id: string) =>
    req<{ ok: boolean; email_hint: string }>(`/players/${player_id}/forgot-password`, {
      method: "POST",
    }),
  resetPassword: (player_id: string, code: string, password: string) =>
    req<AuthResponse>(`/players/${player_id}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ code, password }),
    }),
  fileRawUrl: (file_id: string) => `${BASE}/files/${file_id}/raw`,
  fileThumbUrl: (file_id: string) => `${BASE}/files/${file_id}/thumbnail`,
  uploadFile: async (
    base64: string,
    filename: string,
    mime: string,
    kind: "image" | "file",
    onProgress?: (p: number) => void
  ): Promise<{ file_id: string; mime: string; filename: string; kind: string; size: number }> => {
    const init = await req<{ upload_id: string }>("/files/init", {
      method: "POST",
      body: JSON.stringify({ filename, mime, kind }),
    });
    const uid = init.upload_id;
    const CHUNK = 256 * 1024;
    const total = Math.max(1, Math.ceil(base64.length / CHUNK));
    for (let i = 0; i < total; i++) {
      const data = base64.slice(i * CHUNK, (i + 1) * CHUNK);
      await req<{ ok: boolean }>("/files/chunk", {
        method: "POST",
        body: JSON.stringify({ upload_id: uid, index: i, data }),
      });
      onProgress?.((i + 1) / total);
    }
    return req("/files/finalize", { method: "POST", body: JSON.stringify({ upload_id: uid }) });
  },
};

export type AuthResponse = { access_token: string; player_id: string };

export type Cashbox = {
  key: string;
  label: string;
  email: string;
  recipient_player_id?: string | null;
  recipient_name?: string | null;
  recipient_avatar_file_id?: string | null;
};

export type Payment = {
  id: string;
  cashbox_key: string;
  cashbox_label?: string;
  payer_id: string;
  payer_name?: string;
  amount?: number | null;
  note?: string | null;
  event_id?: string | null;
  status: "open" | "completed";
  paid_at?: string | null;
  paid_by?: string | null;
  created_at: string;
};

export type PaymentSum = {
  cashbox_key: string;
  cashbox_label: string;
  total: number;
  count: number;
};

export type MonthlyOpen = {
  month: string;
  month_label: string;
  total: number;
  count: number;
};

export type PerPlayerOpen = {
  payer_id: string;
  payer_name: string;
  total: number;
  count: number;
};

export type PaymentTotals = {
  open_total: number;
  open_count: number;
  paid_total: number;
  paid_count: number;
};

export type EventOverviewPlayer = {
  id: string;
  name: string;
  position?: string | null;
  status: string;
  jersey_number?: number | null;
  email?: string | null;
  rsvp: "zugesagt" | "abgesagt" | null;
  reason?: string | null;
  driving: boolean;
  beer: boolean;
};

export type EventOverview = {
  event: TeamEvent;
  players: EventOverviewPlayer[];
  summary: { zusagen: number; absagen: number; offen: number; fahrer: number; bier: number };
};

export type Holiday = {
  kind: "feiertag" | "ferien";
  name: string;
  date: string;
  end: string | null;
};

export type LeagueRow = {
  rank: number | null;
  team: string | null;
  points: string | null;
  games: number | null;
  wins: number | null;
  draws: number | null;
  losses: number | null;
  goals: number | null;
  goals_against: number | null;
  goal_diff: number | null;
  is_own: boolean;
};

export type LeagueTable = {
  tournament: string | null;
  updated_at: string | null;
  rows: LeagueRow[];
};

export type BwhvTeam = {
  class_id: string;
  name: string;
  short: string;
  label: string;
  gender: string;
  team_name: string | null;
  is_default: boolean;
};

export type BwhvTeamsResponse = { club: string; teams: BwhvTeam[] };

export type BwhvStanding = {
  rank: number | null;
  team: string | null;
  games: number | null;
  won: number | null;
  draw: number | null;
  lost: number | null;
  goals: number;
  goals_against: number;
  goal_diff: number;
  points: number | null;
  points_str: string | null;
  is_own: boolean;
};

export type BwhvGame = {
  id: string;
  date: string;
  iso: string | null;
  weekday: string;
  time: string;
  home: string;
  guest: string;
  home_goals: number | null;
  guest_goals: number | null;
  played: boolean;
  is_home: boolean;
  gym: string;
  town: string;
};

export type BwhvClass = {
  class_id: string;
  class_name: string | null;
  team_name: string | null;
  table: BwhvStanding[];
  games: BwhvGame[];
};

export type ChatMessage = {
  id: string;
  conversation_id: string;
  scope: string;
  sender_id: string;
  sender_name: string;
  text: string;
  attachment?: Attachment | null;
  created_at: string;
  poll?: {
    kind: "sekt";
    target_player_id: string;
    target_name: string;
    year: number;
    voters: string[];
  } | null;
};

export type ConversationSummary = {
  player_id: string;
  name: string;
  position?: string | null;
  conversation_id: string;
  last: ChatMessage | null;
  unread: number;
};

export type Conversations = {
  team: { conversation_id: string; last: ChatMessage | null; unread: number };
  directs: ConversationSummary[];
};

export type PlayerStat = {
  id: string;
  name: string;
  position?: string | null;
  games_total: number;
  games_confirmed: number;
  games_rate: number;
  trainings_total: number;
  trainings_confirmed: number;
  trainings_rate: number;
  overall_confirmed: number;
  overall_total: number;
  overall_rate: number;
  past_confirmed?: number;
  past_declined?: number;
  past_total?: number;
  past_rate?: number;
  driving_count: number;
  beer_count: number;
  streak?: number;
  month_training_confirmed?: number;
  month_training_total?: number;
  month_training_rate?: number;
};

export type StatsResponse = {
  players: PlayerStat[];
  scope?: string;
  games_count: number;
  trainings_count: number;
  past_games_count?: number;
  past_trainings_count?: number;
  month_training_count?: number;
};
