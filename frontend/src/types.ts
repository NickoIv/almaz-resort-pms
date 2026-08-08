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