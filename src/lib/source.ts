import { loader } from 'fumadocs-core/source'
import { docs } from '@/.source'
import { i18n } from './i18n'

export const iterationSource = loader({
  baseUrl: '/i',
  i18n,
  source: docs.toFumadocsSource(),
})
