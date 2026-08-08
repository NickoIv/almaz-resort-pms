import { useEffect, useState } from 'react'
import { api } from '../api'

type Settings = { text?: { reviews_2gis_url?: string; reviews_google_url?: string } }

/**
 * Quick way out to the public review profiles, so staff can open one at
 * checkout and ask the guest to leave a review.
 *
 * Just links — no review data is pulled. Rendered only when at least one URL
 * is configured, and only for roles allowed to read settings, so a housekeeper
 * never sees a failed request. Opened with noreferrer so the PMS URL is not
 * leaked to the review site.
 */
export default function ReviewsLink() {
  const [links, setLinks] = useState<{ label: string; url: string }[]>([])

  useEffect(() => {
    api<Settings>('/settings')
      .then((data) => {
        const found = [
          { label: '2ГИС', url: data.text?.reviews_2gis_url ?? '' },
          { label: 'Google', url: data.text?.reviews_google_url ?? '' },
        ].filter((item) => item.url.startsWith('http'))
        setLinks(found)
      })
      // Non-admins cannot read settings; the button simply does not appear.
      .catch(() => setLinks([]))
  }, [])

  if (links.length === 0) return null

  return (
    <div className="reviews">
      <span className="reviews-label">Отзывы</span>
      {links.map((link) => (
        <a
          key={link.label}
          className="reviews-link"
          href={link.url}
          target="_blank"
          rel="noreferrer noopener"
          title={`Открыть профиль в ${link.label}`}
        >
          {link.label}
        </a>
      ))}
    </div>
  )
}
