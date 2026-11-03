export function initBankTooltips(vault) {
  const tooltip = document.createElement('div');
  tooltip.id = 'bank-item-tooltip';
  tooltip.className = 'bank-item-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  document.body.append(tooltip);
  let active;

  function hide() {
    active?.removeAttribute('aria-describedby');
    active = null;
    tooltip.hidden = true;
  }

  function show(tile) {
    if (!tile || !vault.contains(tile)) return;
    hide();
    active = tile;
    tooltip.textContent = tile.dataset.tooltip;
    tooltip.hidden = false;
    tile.setAttribute('aria-describedby', tooltip.id);
    const slot = tile.getBoundingClientRect();
    const box = tooltip.getBoundingClientRect();
    const left = Math.max(8, Math.min(slot.left, document.documentElement.clientWidth - box.width - 8));
    const above = slot.top - box.height - 8;
    const top = above >= 8 ? above : Math.min(slot.bottom + 8, innerHeight - box.height - 8);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(8, top)}px`;
  }

  vault.addEventListener('pointerover', event => show(event.target.closest('.bank-slot')));
  vault.addEventListener('pointerout', event => {
    if (active && !active.contains(event.relatedTarget)) hide();
  });
  vault.addEventListener('focusin', event => show(event.target.closest('.bank-slot')));
  vault.addEventListener('focusout', hide);
  document.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
  return { hide };
}
