import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'
import { i18n } from '@/lib/i18n'
import { t } from '@/lib/messages'

const alt = (locale: string) => {
  if (locale === 'en') return 'Logo'
  if (locale === 'ko') return '로고'
  return 'Logo'
}

const logo = '/assets/logo.png'

export function baseOptions(locale: string): BaseLayoutProps {
  const withLocale = (path: string) => `/${locale}${path}`
  return {
    i18n,
    links: [
      {
        active: 'nested-url',
        on: 'nav',
        text: t(locale, 'nav.iteration'),
        type: 'main',
        url: withLocale('/i/000000'),
      },
    ],
    nav: {
      title: (
        <>
          <img src={logo} alt={alt(locale)} width={24} height={24} style={{ display: 'block', borderRadius: '50%' }} />
          <span>{t(locale, 'nav.title')}</span>
        </>
      ),
      url: withLocale(''),
    },
  }
}
