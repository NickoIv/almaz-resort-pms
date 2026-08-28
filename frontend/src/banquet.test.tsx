import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import UnitCard from './components/UnitCard'
import { makeUnit, mockApi, renderApp, signIn, STAFF } from './test-utils'

/**
 * §45 — костровая зона.
 *
 * Гостиница сдаёт её целиком под одно событие: беседки, топчаны и сцена, до ста
 * гостей, банкетное меню от 17 000 ₸ с человека. Это одна бронь на пакет, а не
 * восемь на его части — держать восемь в согласии при каждой правке дат, отмене
 * и оплате никто бы не стал, а деньги за событие всё равно одни.
 *
 * Отсюда единственная опасность, ради которой этот раздел и существует:
 * отдельной брони на беседке внутри события нет, поэтому без специальной заботы
 * она выглядит свободной ровно в тот вечер, когда её продавать нельзя. Запрет
 * проверяется против живого Worker'а в `smoke-banquet.mjs` (21 проверка), здесь
 * — то, что видит человек.
 */

const EVENT = {
  id: 77,
  guest_name: 'Юбилей Ахметовых',
  date_from: '2026-08-28 17:00',
  date_to: '2026-08-28 23:00',
}

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

function card(unit: ReturnType<typeof makeUnit>) {
  mockApi({ 'GET /api/auth/me': { user: STAFF.admin } })
  signIn('admin')
  renderApp(<UnitCard unit={unit} onOpen={vi.fn()} />)
}

describe('§45 беседка внутри события не выглядит свободной', () => {
  const inside = makeUnit({
    id: 21,
    type: 'gazebo',
    name: 'Беседка 1',
    status: 'free',
    zone: { id: 27, name: 'Костровая зона', booking: EVENT },
  })

  it('говорит, что занята, хотя своей брони на ней нет', () => {
    card(inside)

    // По данным беседка свободна: событие — одна бронь на зону. Без этой строки
    // официант увидел бы «Свободен» и посадил бы на юбилей чужую компанию.
    expect(screen.getByText('Событие')).toBeTruthy()
    expect(screen.queryByText('Свободен')).toBeNull()
  })

  it('и называет, чьё событие и когда', () => {
    card(inside)

    expect(screen.getByText('Юбилей Ахметовых')).toBeTruthy()
    expect(screen.getByText(/вся костровая зона/)).toBeTruthy()
  })

  it('свободная беседка вне зоны остаётся свободной', () => {
    card(makeUnit({ id: 24, type: 'gazebo', name: 'Беседка 4', status: 'free' }))

    // Запрет обязан бить точно: если бы он распространялся на всю зону отдыха,
    // событие останавливало бы продажу того, что к нему не относится.
    expect(screen.getByText('Свободен')).toBeTruthy()
    expect(screen.queryByText('Событие')).toBeNull()
  })
})

describe('§45 событие меряется гостями', () => {
  it('на карточке написано, на сколько человек накрывать', () => {
    card(
      makeUnit({
        id: 27,
        type: 'banquet_zone',
        name: 'Костровая зона',
        capacity: 100,
        status: 'occupied',
        current_booking: { ...EVENT, guests_count: 40 },
      })
    )

    // Это первое, что спрашивают о событии, — раньше времени и раньше денег.
    expect(screen.getByText(/40 гостей/)).toBeTruthy()
  })
})
