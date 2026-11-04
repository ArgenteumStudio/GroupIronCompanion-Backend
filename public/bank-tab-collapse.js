export function bankTabCollapse() {
  const owners = new Map();
  const isCollapsed = (owner, tab) => owners.get(owner)?.has(tab) ?? false;
  return {
    isCollapsed,
    clear: () => owners.clear(),
    bind(button, owner, tab, render) {
      button.setAttribute('aria-expanded', String(!isCollapsed(owner, tab)));
      button.title += ` - right-click to ${isCollapsed(owner, tab) ? 'expand' : 'collapse'}`;
      const toggle = event => {
        event.preventDefault();
        let tabs = owners.get(owner);
        if (!tabs) owners.set(owner, tabs = new Set());
        if (!tabs.delete(tab)) tabs.add(tab);
        render();
      };
      button.addEventListener('contextmenu', toggle);
      button.addEventListener('keydown', event => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) toggle(event);
      });
    },
  };
}
