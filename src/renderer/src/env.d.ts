/// <reference types="vite/client" />
import type { MatzioApi } from '../../preload'

declare global {
  interface Window {
    matzio?: MatzioApi
  }
}
