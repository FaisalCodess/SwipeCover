// Single source of truth for keyboard controls. The in-game input handler and
// both settings screens read from this list, so what is shown is what works.
export const KEY_BINDINGS = [
  { action: 'up', name: 'Up', label: 'W', keys: ['w', 'arrowup'] },
  { action: 'left', name: 'Left', label: 'A', keys: ['a', 'arrowleft'] },
  { action: 'down', name: 'Down', label: 'S', keys: ['s', 'arrowdown'] },
  { action: 'right', name: 'Right', label: 'D', keys: ['d', 'arrowright'] },
  { action: 'restart', name: 'Restart', label: 'R', keys: ['r'] },
  { action: 'pause', name: 'Pause', label: 'Esc', keys: ['escape', 'p'] },
];

// Lower-cased `KeyboardEvent.key` mapped to its action.
export const KEY_ACTIONS = Object.fromEntries(
  KEY_BINDINGS.flatMap(({ action, keys }) => keys.map((key) => [key, action])),
);
