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
  cancelled_at?: string | null
  /**
   * When someone read the finished booking back and confirmed it, and who.
   * Null means nobody has — including on every booking made before the check
   * existed, which is why it is not treated as a warning on its own.
   */
  verified_at?: string | null
  verified_by_name?: string | null
  /** Money fields are present only for the admin role. */
  total_amount?: number
  prepaid_amount?: number
  /** Refundable security hold — never folded into remaining_amount. */
  deposit_amount?: number
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
}

export type CalendarDay = {
  date: string
  status: UnitStatus
  booking_id: number | null
  guest_name: string | null
}

export type Calendar = {
  unit: { id: number; name: string; type: UnitType }
  month: string
  days: CalendarDay[]
  bookings: Booking[]
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
