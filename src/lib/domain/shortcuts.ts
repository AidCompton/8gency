// Keyboard shortcuts. Navigation is "G then a letter" (as in Linear and Gmail); ⌘K / Ctrl+K opens the command menu.
// They never fire while someone is typing in a field (see components/CommandMenu.tsx).

export const GO_KEYS: Record<string, string> = {
  "/app": "h",
  "/app/my-day": "d",
  "/app/chat": "c",
  "/app/jobs": "j",
  "/app/clients": "l",
  "/app/scope": "s",
  "/app/time": "t",
  "/app/bookings": "b",
  "/app/team": "m",
  "/app/automations": "a",
  "/app/retainers": "r",
  "/app/billing": "i",
  "/app/pulse": "p",
  "/app/settings": ",",
  "/app/notifications": "n",
};

/** The keys to show for a page, e.g. ["G", "J"]; undefined when it has none. */
export const goKeys = (href: string): string[] | undefined => (GO_KEYS[href] ? ["G", GO_KEYS[href].toUpperCase()] : undefined);

export const hrefForGoKey = (key: string) => Object.entries(GO_KEYS).find(([, k]) => k === key.toLowerCase())?.[0];

export const COMMAND_KEYS = ["mod", "K"];
export const THEME_KEYS = ["mod", "shift", "L"];
