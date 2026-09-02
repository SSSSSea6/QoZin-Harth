import { harth, HarthError } from './index'

declare global {
  interface Window {
    harth: typeof harth
    HarthError: typeof HarthError
  }
}

window.harth = harth
window.HarthError = HarthError
