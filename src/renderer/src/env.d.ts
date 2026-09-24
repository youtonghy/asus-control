import type { AsusApi } from '@shared/api'

declare global {
  interface Window {
    asus: AsusApi
  }
}
