let enabled = false

/**
 * Turns the package's logging on or off. It is off until an application turns
 * it on.
 */
export function setDevLogging(on: boolean): void {
  enabled = on
}

/**
 * Logs a message to the console while logging is on, and does nothing while
 * it is off.
 */
export function devLog(category: string, message: string, data?: object): void {
  if (!enabled) return
  if (data !== undefined) {
    console.info(`[${category}] ${message}`, data)
  } else {
    console.info(`[${category}] ${message}`)
  }
}
