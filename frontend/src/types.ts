export type Role = 'admin' | 'housekeeper' | 'waiter'

export type UnitType = 'room' | 'sunbed' | 'gazebo' | 'vip_gazebo'

export type UnitStatus = 'free' | 'booked' | 'occupied'

export type StaffUser = {
  id: number
  name: string
  phone: string
  role: Role
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
  /** Money fields are present only for the admin role. */
  total_amount?: number
  prepaid_amount?: number
  deposit_amount?: number
  remaining_amount?: number
  currency?: string
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
}

export type Payment = {
  id: number
  booking_id: number
  amount: number
  method: string
  paid_at: string
}

export type Analytics = {
  range: { from: string; to: string }
  totals: { revenue: number; bookings: number; payments: number }
  by_type: {
    type: UnitType
    category: 'rooms' | 'restaurant'
    revenue: number
    payments: number
    bookings: number
  }[]
  by_category: { rooms: number; restaurant: number }
  occupancy: { nights_sold: number; nights_available: number; rate: number; rooms: number }
  months: { month: string; rooms: number; restaurant: number; revenue: number }[]
  month_over_month: {
    current: { month: string; revenue: number }
    previous: { month: string; revenue: number }
    change: number
  }
}

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