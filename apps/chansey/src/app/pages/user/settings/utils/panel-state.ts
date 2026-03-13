const PREFIX = 'settings.panel.';

export function getPanelCollapsed(key: string): boolean {
  try {
    return localStorage.getItem(`${PREFIX}${key}`) === 'true';
  } catch {
    return false;
  }
}

export function setPanelCollapsed(key: string, collapsed: boolean): void {
  try {
    localStorage.setItem(`${PREFIX}${key}`, String(collapsed));
  } catch {
    // localStorage unavailable
  }
}

export function createPanelState(
  prefix: string,
  keys: string[]
): { collapsed: Record<string, boolean>; onToggle(key: string, event: { collapsed?: boolean }): void } {
  const collapsed: Record<string, boolean> = {};
  for (const key of keys) {
    collapsed[key] = getPanelCollapsed(`${prefix}.${key}`);
  }
  return {
    collapsed,
    onToggle(key: string, event: { collapsed?: boolean }): void {
      const value = event.collapsed ?? false;
      collapsed[key] = value;
      setPanelCollapsed(`${prefix}.${key}`, value);
    }
  };
}

export function createSinglePanelState(key: string): {
  collapsed: boolean;
  onToggle(event: { collapsed?: boolean }): void;
} {
  const state = {
    collapsed: getPanelCollapsed(key),
    onToggle: (event: { collapsed?: boolean }) => {
      const value = event.collapsed ?? false;
      state.collapsed = value;
      setPanelCollapsed(key, value);
    }
  };
  return state;
}
