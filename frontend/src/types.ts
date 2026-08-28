export type Role = 'admin' | 'housekeeper' | 'waiter'

export type UnitType = 'room' | 'sunbed' | 'gazebo' | 'vip_gazebo'

export type UnitStatus = 'free' | 'booked' | 'occupied'

export type StaffUser = {
  id: number
  name: string
  phone: string
  role: Role
}

/** As returned by /api/staff — never includes the PIN hash. */
export type StaffMember = StaffUser & {
  is_active: boolean
}

export type Booking = {
  id: number
  unit_id?: number
  guest_name: string | null
  guest_phone?: string | null
  date_from: string | null
  date_to: string | null
  status?: UnitStatus
  /** Shared with every role — a waiter must know whether the guest still owes. */
  is_paid?: boolean
  /** Set when this booking is part of a multi-unit group booking. */
  group_id?: number | null
  /** Why the booking ended — set when it moves to 'free'. */
  cancel_reason?: string | null
  cancel_note?: string | null
  /** Empty means nobody said — deliberately not the same as "Kazakh". */
  guest_citizenship?: string | null
  guest_document?: string | null
  migration_notified_at?: string | null
  cancelled_at?: string | null
  /**
   * When someone read the finished booking back and confirmed it, and who.
   * Null means nobody has — including on every booking made before the check
   * existed, which is why it is not treated as a warning on its own.
   */
  verified_at?: string | null
  verified_by_name?: string | null
  /**
   * Переселение: the booking this one continues, and the unit it came out of.
   * A stay that begins in the middle of a week reads as a data-entry error
   * until the screen says the guest was moved out of 101 that morning.
   */
  moved_from_booking_id?: number | null
  moved_from_unit_name?: string | null
  /**
   * The day the guest arrived at the hotel, when that is not `date_from`.
   * Carried across a move so the migration deadline does not restart.
   */
  arrived_on?: string | null
  /** Money fields are present only for the admin role. */
  total_amount?: number
  prepaid_amount?: number
  /** Refundable security hold — never folded into remaining_amount. */
  deposit_amount?: number
  /**
   * How much of the hold went back, and when. **null is not 0**: null means
   * nobody has returned it yet, 0 means the whole hold was kept.
   */
  deposit_returned?: number | null
  deposit_returned_at?: string | null
  deposit_returned_by_name?: string | null
  deposit_note?: string | null
  /** Penalties and extras, on top of the unit rate. */
  charges_amount?: number
  /** rate + charges − prepaid. Excludes the deposit. */
  remaining_amount?: number
  currency?: string
}

export type Charge = {
  id: number
  booking_id: number
  reason: string
  amount: number
  created_at: string
  created_by_name: string | null
}

export type GuestStay = {
  booking_id: number
  unit_name: string
  unit_type: UnitType
  date_from: string
  date_to: string
  status: UnitStatus
  total_amount: number
  charges_amount: number
  prepaid_amount: number
  deposit_amount: number
  remaining_amount: number
  currency: string
}

export type GuestHistory = {
  phone: string
  guest_name: string | null
  total_stays: number
  past_stays: number
  outstanding_debt: number
  lifetime_spend: number
  notes: string
  notes_updated_at: string | null
  stays: GuestStay[]
}

export type BookingGroup = {
  id: number
  name: string
  guest_name: string
  guest_phone: string | null
  note: string | null
  created_at: string
}

export type GroupDetail = {
  group: BookingGroup
  bookings: (Booking & { unit_name: string | null; unit_type: UnitType | null })[]
}

export type Unit = {
  id: number
  type: UnitType
  name: string
  category: string | null
  capacity: number
  status: UnitStatus
  needs_cleaning: boolean
  cleaning_pending: number
  cleaning_total: number
  current_booking: Booking | null
  next_booking: Booking | null
  /**
   * A booking whose dates are behind us and which was never closed — the guest
   * never arrived, or was never checked out. **Not** the unit's status: the
   * room is free and sellable. It is a loose end, and until it was surfaced
   * the «Гость не заехал» alert led to a page with nothing on it.
   */
  unclosed_booking?: Booking | null
  /**
   * Снят с продажи сегодня — ремонт, санобработка, служебная бронь.
   *
   * Deliberately not a `status`: the room is empty and clean, it simply cannot
   * be sold. «Занят» would send someone looking for a guest who is not there.
   */
  block?: UnitBlock | null
  /**
   * На реставрации — объекта физически ещё нет.
   *
   * Не `status` и не `block`. Статус описывает стоянку гостя, а тут стоянки
   * быть не может; блокировка — это отрезок календаря с концом, а здесь конца
   * никто не знает. `null` — обычный объект, и такими остаются все, пока
   * человек не отметит обратное.
   */
  renovation?: Renovation | null
}

export type Renovation = {
  since: string
  note: string | null
  by_name?: string | null
}

/** Объект, снятый с продажи. Half-open dates, like everything else here. */
export type UnitBlock = {
  id: number
  unit_id?: number
  date_from: string
  date_to: string
  reason: string
  note: string | null
  created_at?: string
  created_by_name?: string | null
  unit_name?: string
  unit_type?: UnitType
}

export type CalendarDay = {
  date: string
  status: UnitStatus
  booking_id: number | null
  guest_name: string | null
  /** Off sale: pressing it must not open a form the server will refuse. */
  blocked?: { id: number; reason: string; note: string | null } | null
}

export type Calendar = {
  unit: { id: number; name: string; type: UnitType }
  month: string
  days: CalendarDay[]
  bookings: Booking[]
  blocks?: UnitBlock[]
}

/**
 * «Сегодня» — one row of the arrivals or departures list.
 *
 * Money fields are admin-only, like everywhere else; `is_paid` is the one
 * exception, because a waiter has to know whether the guest still owes.
 */
export type TodayRow = {
  booking_id: number
  unit_id: number
  unit_name: string
  unit_type: UnitType
  guest_name: string
  guest_phone: string | null
  date_from: string
  date_to: string
  nights: number
  status: UnitStatus
  verified_at: string | null
  needs_cleaning: boolean
  cleaning_pending: number
  /** Foreign guest, notice not filed — three days from arrival and a fine. */
  migration_due: boolean
  is_paid: boolean
  total_amount?: number
  prepaid_amount?: number
  deposit_amount?: number
  /** Still held — the last thing a checkout owes the guest. */
  deposit_pending?: boolean
  charges_amount?: number
  remaining_amount?: number
  currency?: string
}

export type TodayBoard = {
  today: string
  arrivals: TodayRow[]
  departures: TodayRow[]
  /** In-house tonight and neither arriving nor leaving today. */
  staying: number
  blocked: { id: number; unit_name: string; reason: string; note: string | null; date_to: string }[]
}

export type ChecklistItem = {
  id: number
  unit_id: number
  booking_id: number | null
  item_name: string
  is_done: boolean
  updated_at: string | null
  updated_by: number | null
  updated_by_name: string | null
}

export type CleaningUnit = {
  id: number
  type: UnitType
  name: string
  category: string | null
  total: number
  pending: number
  /** Almaty wall-clock time the unit started needing cleaning. */
  waiting_since: string | null
  waiting_minutes: number
  is_overdue: boolean
}

export type CleaningOverview = {
  /** Threshold in minutes; sent by the API so the UI keeps no copy of it. */
  sla_minutes: number
  units: CleaningUnit[]
}

/**
 * How a payment reads in Russian. `adjustment` is written by the server when an
 * admin corrects the prepaid figure outright — nobody handed anything over, and
 * calling it a payment method would put money in a till that never saw any.
 */
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'наличные',
  card: 'карта',
  kaspi: 'Kaspi',
  transfer: 'перевод',
  adjustment: 'корректировка',
}

export type Payment = {
  id: number
  booking_id: number
  amount: number
  method: string
  paid_at: string
  /** Present when the instalment was part of a combined group payment. */
  group_id: number | null
  /** Who physically took the money. Null on rows written before this existed. */
  received_by: number | null
  received_by_name: string | null
  /** Who entered it — always an admin, since only admins may record payments. */
  recorded_by: number | null
  recorded_by_name: string | null
}

export type Analytics = {
  range: { from: string; to: string }
  totals: {
    /** Money actually collected. */
    revenue: number
    /** What the bookings in range are worth, paid or not. */
    accrued: number
    /** Still owed across those bookings. */
    outstanding: number
    bookings: number
    paid_bookings: number
    payments: number
  }
  by_type: {
    type: UnitType
    category: 'rooms' | 'restaurant'
    revenue: number
    payments: number
    bookings: number
  }[]
  by_category: { rooms: number; restaurant: number }
  occupancy: { nights_sold: number; nights_available: number; rate: number; rooms: number }
  /** dow 0 = Monday … 6 = Sunday. */
  weekdays: {
    dow: number
    revenue: number
    payments: number
    days: number
    nights_sold: number
    nights_available: number
    occupancy_rate: number
  }[]
  months: { month: string; rooms: number; restaurant: number; revenue: number }[]
  month_over_month: {
    current: { month: string; revenue: number }
    previous: { month: string; revenue: number }
    change: number
  }
}

export const CURRENCIES = ['KZT', 'USD', 'CNY'] as const

export type Currency = (typeof CURRENCIES)[number]

export const CURRENCY_LABELS: Record<Currency, string> = {
  KZT: '₸ тенге',
  USD: '$ доллар',
  CNY: '¥ юань',
}

export const DEFAULT_CURRENCY: Currency = 'KZT'

export const UNIT_TYPE_LABELS: Record<UnitType, string> = {
  room: 'Номер',
  sunbed: 'Топчан',
  gazebo: 'Беседка',
  vip_gazebo: 'VIP-беседка',
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Администратор',
  housekeeper: 'Горничная',
  waiter: 'Официант',
}

export const STATUS_LABELS: Record<UnitStatus, string> = {
  free: 'Свободен',
  booked: 'Забронирован',
  occupied: 'Занят',
}
export type PaymentActRow = {
  id: number
  paid_at: string
  amount: number
  method: string
  group_id: number | null
  booking_id: number
  guest_name: string
  guest_phone: string | null
  currency: string
  date_from: string
  date_to: string
  unit_name: string
  unit_type: UnitType
  /** Cumulative sum in payment order, so the last row reconciles to the total. */
  running_total: number
}

export type PaymentAct = {
  range: { from: string; to: string }
  count: number
  total: number
  by_method: Record<string, number>
  payments: PaymentActRow[]
}

export type WaitlistStatus = 'open' | 'placed' | 'closed'

export type WaitlistEntry = {
  id: number
  guest_name: string
  guest_phone: string | null
  unit_type: UnitType
  unit_id: number | null
  unit_name: string | null
  date_from: string
  date_to: string
  note: string | null
  status: WaitlistStatus
  created_at: string
  created_by_name: string | null
  /** Requested dates already in the past. */
  is_stale?: boolean
}

/**
 * One bar on the room timeline. Dates are the booking's true range, and the
 * money travels with it so the board can open the edit form without a second
 * request. The endpoint is admin-only, which is what makes that safe.
 */
export type TimelineBooking = {
  id: number
  guest_name: string | null
  guest_phone: string | null
  status: UnitStatus
  date_from: string
  date_to: string
  total_amount: number
  prepaid_amount: number
  deposit_amount: number
  charges_amount: number
  remaining_amount: number
  currency: string
}

export type TimelineRoom = {
  unit_id: number
  unit_name: string
  category: string | null
  capacity: number
  bookings: TimelineBooking[]
  /**
   * Nights the room is off sale. Folded into the same per-room list the board
   * derives everything from, so the free-per-night header, the drag collision
   * check and the cell shading cannot disagree about what is sellable.
   */
  blocks?: UnitBlock[]
  /** Строка остаётся на доске, но помеченной: спрятанный инвентарь забывают. */
  renovation?: { since: string; note: string | null } | null
}

/**
 * The year at month granularity — twelve columns instead of 365.
 *
 * Nights sold rather than bookings counted: two one-night stays fill a room the
 * same as one two-night stay, and at this range it is the filling being asked
 * about, not the paperwork.
 */
export type RoomYearMonth = {
  month: string
  nights_sold: number
  nights_total: number
}

export type RoomYear = {
  year: number
  rooms_total: number
  months: {
    month: string
    nights_total: number
    nights_sold: number
    nights_available: number
    occupancy_rate: number
    /** Rooms with nothing at all booked that month. */
    rooms_free: number
  }[]
  rooms: {
    unit_id: number
    unit_name: string
    category: string | null
    capacity: number
    months: RoomYearMonth[]
  }[]
}

export type RoomTimeline = {
  from: string
  days: number
  /** The server's cap, so the UI never offers a window it would clamp. */
  max_days: number
  dates: string[]
  rooms: TimelineRoom[]
}

/**
 * The price list — two prices per unit type and category, plus optional
 * seasons. See backend/src/lib/rates.ts for why it is deliberately this small.
 */
export type Rate = {
  id: number
  unit_type: UnitType
  /** null — any category of this type. */
  category: string | null
  weekday_price: number
  weekend_price: number
  season_name: string | null
  season_from: string | null
  season_to: string | null
}

/** A row as it is being edited, before it has ever been saved. */
export type RateDraft = Omit<Rate, 'id'> & { id?: number }

export type Quote = {
  total: number
  nights: {
    date: string
    kind: 'weekday' | 'weekend'
    season: string | null
    price: number
  }[]
  /** The list had nothing to say about this stay; suggest nothing. */
  empty: boolean
}

/**
 * Переселение, as the server describes it before anything is written.
 *
 * `mode` is the server's reading of the dates, not a choice this screen offers:
 * a stay that has not started moves whole, one under way splits at today. See
 * backend/src/lib/transfer.ts.
 */
export type TransferPlan = {
  mode: 'whole' | 'split'
  /** The day the stay divides, when it does. */
  split_on: string | null
  moved_from: string
  date_to: string
  nights_before: number
  nights_after: number
  from_unit: { id: number; name: string; type: UnitType }
  /** Money fields, admin only — the same rule as everywhere else. */
  currency?: string
  total_amount?: number
  prepaid_amount?: number
  charges_amount?: number
  deposit_amount?: number
  suggested_stay_amount?: number
  suggested_move_amount?: number
  units: {
    id: number
    name: string
    category: string | null
    capacity: number
    /** Free for the whole remaining span, by the same rule the POST enforces. */
    free: boolean
    /** Who is in it otherwise — so "why not 105" has an answer on the screen. */
    taken_by: string | null
    needs_cleaning: boolean
    /** The price list's answer for these nights in this unit; null if it has none. */
    quote?: number | null
  }[]
}

export type TransferResult = {
  mode: 'whole' | 'split'
  from_unit: { id: number; name: string }
  to_unit: { id: number; name: string }
  split_on?: string | null
  nights_before?: number
  nights_after?: number
  /** Prepayment that followed the guest to the new booking. */
  carried_amount?: number
  booking: Booking
  /** The closed leg, on a split. Null when the whole booking simply moved. */
  previous: Booking | null
}

/** What GET /api/guests/:phone answers — the parts the booking form uses. */
export type KnownGuest = {
  phone: string
  guest_name: string | null
  total_stays: number
  past_stays: number
  outstanding_debt: number
  lifetime_spend: number
  notes: string
}

/**
 * Миграционный учёт — Kazakhstan gives the receiving party three days from a
 * foreign guest's arrival to notify the migration service, and fines a hotel
 * that misses it. See backend/src/lib/migration-notice.ts for why an unrecorded
 * citizenship is deliberately not the same as a foreign one.
 */
export const KZ_CITIZENSHIP = 'KZ'

/** The countries reception actually types, in the order they come up here. */
export const CITIZENSHIPS = [
  { value: KZ_CITIZENSHIP, label: 'Казахстан' },
  { value: 'Россия', label: 'Россия' },
  { value: 'Кыргызстан', label: 'Кыргызстан' },
  { value: 'Узбекистан', label: 'Узбекистан' },
  { value: 'Китай', label: 'Китай' },
  { value: 'Турция', label: 'Турция' },
] as const

export type MigrationEntry = {
  booking_id: number
  guest_name: string
  guest_phone: string | null
  guest_citizenship: string | null
  guest_document: string | null
  date_from: string
  date_to: string
  unit_id: number
  unit_name: string
  migration_notified_at: string | null
  migration_notified_by_name: string | null
  due_on?: string
  days_left?: number
}

export type MigrationRegister = {
  today: string
  notice_days: number
  hotel_name: string
  hotel_address: string
  /** Foreign guests who have arrived and have not been filed. */
  due: MigrationEntry[]
  /** Arrivals whose citizenship nobody recorded — shown so silence cannot hide one. */
  unknown: MigrationEntry[]
  filed: MigrationEntry[]
}
