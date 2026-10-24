import { useDark } from '@vueuse/core'

/**
 * Shared dark-mode state: starts from the OS preference, toggles the "dark" class on
 * <html> and remembers the choice in localStorage ("vueuse-color-scheme").
 * index.html reads the same key before the first paint to avoid a light flash.
 */
export const isDark = useDark()
