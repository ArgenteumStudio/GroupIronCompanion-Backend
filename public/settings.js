// Owner-only settings editor. Fields are generated from the server's defaults so new settings appear automatically.
const $ = id => document.getElementById(id);
const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

const GROUPS = [
  { title: 'Group', path: [], keys: { clanName: ['Clan name', 'Shown on the website and in {clan} placeholders.', 40] } },
  { title: 'Website text', path: ['website'], keys: {
    title: ['Browser tab title', '', 80], tagline: ['Sidebar tagline', '', 40],
    heading: ['Login heading', 'Press Enter for a line break.', 120, 'area'], intro: ['Login introduction', '', 300, 'area'],
    dashboardHeading: ['Dashboard heading', '', 80], dashboardSubtitle: ['Dashboard subtitle', '', 200],
    bankHeading: ['Bank section heading', '', 80], activityHeading: ['Activity section heading', '', 80],
    footer: ['Footer text', '', 200],
  } },
  { title: 'Website colours', path: ['website', 'colors'], keys: {
    background: ['Background'], panel: ['Panels'], border: ['Borders'], text: ['Text'],
    muted: ['Secondary text'], accent: ['Accent'], highlight: ['Highlight'],
  } },
  { title: 'Discord messages', path: ['discord'], keys: {
    footer: ['Embed footer', '{clan} is replaced with your clan name.', 200],
    useLogoIcon: ['Use the clan logo as the embed icon'],
  } },
  { title: 'Discord message titles', path: ['discord', 'titles'], keys: {
    loot: ['Loot drop'], valuable: ['Valuable drop'], rare: ['Rare drop'], legendary: ['Legendary drop'],
    boss: ['Boss kill'], milestone: ['Kill count milestone'], quest: ['Quest complete'], chat: ['Group chat'],
    stats: ['Player stats'], key: ['Access key DM'], verification: ['Verification replies'],
  } },
  { title: 'Discord colours', path: ['discord', 'colors'], keys: {
    loot: ['Loot drop'], valuable: ['Valuable drop'], rare: ['Rare drop'], legendary: ['Legendary drop'],
    boss: ['Boss kill'], milestone: ['Kill count milestone'], quest: ['Quest complete'], chat: ['Group chat'],
    stats: ['Player stats'], key: ['Access key DM'], success: ['Success'], warning: ['Warning'], error: ['Error'],
  } },
  { title: 'Drop value tiers (gp)', hint: 'A drop worth at least this much uses the matching title and colour.', path: ['discord', 'lootTiers'], keys: {
    valuable: ['Valuable from'], rare: ['Rare from'], legendary: ['Legendary from'],
  } },
  { title: 'Kill count milestones', hint: 'Celebrate every N kills, switching to a larger step after a threshold.', path: ['discord', 'milestones'], keys: {
    every: ['Every N kills'], largeFrom: ['Large step from KC'], largeEvery: ['Then every N kills'],
  } },
];
const CSS_VARS = { background: '--bg', panel: '--panel', border: '--border', text: '--cream', muted: '--muted', accent: '--green', highlight: '--gold' };
const PREVIEWS = {
  valuable: ['Abyssal whip', 'Iron Ada received 1 x Abyssal whip from Abyssal demon.\nValue: 1.42M gp'],
  legendary: ['Twisted bow', 'Rune Rook received 1 x Twisted bow from Chambers of Xeric.\nValue: 1.2B gp'],
  boss: ['Vorkath', 'Lumby Lad defeated Vorkath. Kill count: 37'],
  milestone: ['Zulrah', 'Zezima Jr reached 500 Zulrah kills!'],
  quest: ['Dragon Slayer II', 'Iron Ada completed Dragon Slayer II.'],
  chat: ['Rune Rook', 'anyone got a spare stamina potion?'],
  stats: ['Iron Ada', 'Total level 1,872 · Combat 112'],
  key: ['Your private access key', 'Linked player: Iron Ada'],
};
const at = (object, path) => path.reduce((value, key) => value?.[key], object);

export function initSettings({ authHeader, onError }) {
  let current = null, defaults = null, logo = null, removeLogo = false, customLogo = false;
  let mapIcon = null, removeMapIcon = false;
  const inputs = [];

  function field(group, key, [label, hint = '', max, kind]) {
    const sample = at(defaults, group.path)[key];
    const wrap = document.createElement('label');
    wrap.className = typeof sample === 'boolean' ? 'setting check' : 'setting';
    const caption = document.createElement('span');
    caption.textContent = label;
    let input;
    if (typeof sample === 'boolean') input = Object.assign(document.createElement('input'), { type: 'checkbox' });
    else if (typeof sample === 'number') input = Object.assign(document.createElement('input'), { type: 'number', min: 1, step: 1 });
    else if (group.path.at(-1) === 'colors') input = Object.assign(document.createElement('input'), { type: 'color' });
    else if (kind === 'area') input = Object.assign(document.createElement('textarea'), { rows: 2, maxLength: max });
    else input = Object.assign(document.createElement('input'), { type: 'text', maxLength: max });
    input.dataset.path = [...group.path, key].join('.');
    input.addEventListener('input', changed);
    inputs.push({ input, path: [...group.path, key], sample });
    if (typeof sample === 'boolean') wrap.append(input, caption);
    else wrap.append(caption, input);
    if (hint) wrap.append(Object.assign(document.createElement('small'), { textContent: hint }));
    return wrap;
  }

  function logoField() {
    const wrap = document.createElement('div');
    wrap.className = 'setting logo-setting';
    const caption = Object.assign(document.createElement('span'), { textContent: 'Clan logo' });
    const preview = Object.assign(document.createElement('img'), { id: 'settings-logo', alt: 'Logo preview' });
    const file = Object.assign(document.createElement('input'), { type: 'file', accept: LOGO_TYPES.join(',') });
    file.setAttribute('aria-label', 'Upload a clan logo');
    const badge = Object.assign(document.createElement('button'), { type: 'button', className: 'quiet', textContent: 'Use initials badge' });
    const note = Object.assign(document.createElement('small'), { textContent: 'PNG, JPEG, GIF or WebP, up to 5 MB. Square images look best.' });
    file.addEventListener('change', () => {
      const chosen = file.files[0];
      file.value = '';
      if (!chosen) return;
      if (!LOGO_TYPES.includes(chosen.type) || chosen.size > MAX_LOGO_BYTES) {
        status('Logo must be a PNG, JPEG, GIF or WebP image of 5 MB or smaller.', true);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        logo = { data: String(reader.result).split(',')[1], url: reader.result };
        removeLogo = false;
        changed();
      };
      reader.readAsDataURL(chosen);
    });
    badge.addEventListener('click', () => {
      logo = null;
      removeLogo = true;
      changed();
    });
    const row = document.createElement('div');
    row.className = 'logo-row';
    row.append(preview, file, badge);
    wrap.append(caption, row, note);
    return wrap;
  }

  function build() {
    inputs.length = 0;
    const sections = GROUPS.map(group => {
      const set = document.createElement('fieldset');
      set.append(Object.assign(document.createElement('legend'), { textContent: group.title }));
      if (group.hint) set.append(Object.assign(document.createElement('p'), { className: 'fine', textContent: group.hint }));
      const grid = document.createElement('div');
      grid.className = 'settings-grid';
      if (!group.path.length) grid.append(logoField(), mapIconField());
      for (const [key, meta] of Object.entries(group.keys)) grid.append(field(group, key, meta));
      set.append(grid);
      return set;
    });
    $('settings-fields').replaceChildren(...sections);
    $('preview-kind').replaceChildren(...Object.keys(PREVIEWS).map(kind =>
      Object.assign(document.createElement('option'), { value: kind, textContent: GROUPS[4].keys[kind]?.[0] ?? kind })));
  }

  function mapIconField() {
    const wrap = Object.assign(document.createElement('div'), { className: 'setting logo-setting' });
    const caption = Object.assign(document.createElement('span'), { textContent: 'In-game map icon' });
    const image = Object.assign(document.createElement('img'), { id: 'settings-map-icon', alt: 'In-game map marker preview' });
    const file = Object.assign(document.createElement('input'), { type: 'file', accept: LOGO_TYPES.join(',') });
    file.setAttribute('aria-label', 'Upload an in-game map icon');
    const reset = Object.assign(document.createElement('button'), { type: 'button', className: 'quiet', textContent: 'Use default map dot' });
    const note = Object.assign(document.createElement('small'), {
      textContent: 'For your RuneLite world-map marker and all group markers, separate from the clan logo. PNG, JPEG, GIF or WebP, up to 1 MB and 2048 x 2048. Saved as a 32px PNG; transparent, square images work best. Updated clients refresh within about 30 seconds of a successful bridge sync.',
    });
    file.addEventListener('change', () => {
      const chosen = file.files[0];
      file.value = '';
      if (!chosen) return;
      if (!LOGO_TYPES.includes(chosen.type) || chosen.size > 1024 * 1024) {
        status('Map icon must be a PNG, JPEG, GIF or WebP image of 1 MB or smaller.', true);
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => status('Map icon could not be read. Please choose the image again.', true);
      reader.onload = () => {
        mapIcon = { data: String(reader.result).split(',')[1], url: reader.result };
        removeMapIcon = false;
        changed();
      };
      reader.readAsDataURL(chosen);
    });
    reset.addEventListener('click', () => {
      mapIcon = null;
      removeMapIcon = true;
      changed();
    });
    const row = Object.assign(document.createElement('div'), { className: 'logo-row map-icon-row' });
    const dot = Object.assign(document.createElement('span'), { id: 'settings-map-dot', className: 'map-icon-dot', hidden: true });
    dot.setAttribute('aria-label', 'Default cyan map dot');
    row.append(image, dot, file, reset);
    wrap.append(caption, row, note);
    return wrap;
  }

  function fill(settings) {
    for (const { input, path } of inputs) {
      const value = at(settings, path);
      if (input.type === 'checkbox') input.checked = value;
      else input.value = String(value);
    }
  }

  function read() {
    const settings = structuredClone(defaults);
    for (const { input, path, sample } of inputs) {
      const parent = at(settings, path.slice(0, -1));
      const key = path.at(-1);
      if (typeof sample === 'boolean') parent[key] = input.checked;
      else if (typeof sample === 'number') parent[key] = Number(input.value);
      else parent[key] = input.value;
    }
    return settings;
  }

  function changed() {
    const settings = read();
    const root = document.documentElement.style;
    for (const [key, variable] of Object.entries(CSS_VARS)) root.setProperty(variable, settings.website.colors[key]);
    $('settings-logo').src = logo?.url ?? (removeLogo ? '' : $('settings-logo').dataset.saved);
    $('settings-logo').hidden = removeLogo && !logo;
    $('settings-map-icon').src = mapIcon?.url ?? $('settings-map-icon').dataset.saved;
    $('settings-map-icon').hidden = removeMapIcon;
    $('settings-map-dot').hidden = !removeMapIcon;
    preview(settings);
    status('');
  }

  function preview(settings) {
    const kind = $('preview-kind').value || 'valuable';
    const [title, body] = PREVIEWS[kind];
    const colorKey = Object.hasOwn(settings.discord.colors, kind) ? kind : 'loot';
    $('embed-preview').style.borderLeftColor = settings.discord.colors[colorKey];
    $('embed-category').textContent = settings.discord.titles[kind];
    $('embed-title').textContent = title;
    $('embed-body').textContent = body;
    const footer = settings.discord.footer.replaceAll('{clan}', settings.clanName).replace(/\s+/g, ' ').trim();
    $('embed-footer').textContent = footer || 'Clan Tracker';
    const useLogo = settings.discord.useLogoIcon && (logo || (customLogo && !removeLogo));
    for (const id of ['embed-icon', 'embed-footer-icon']) {
      $(id).hidden = !useLogo;
      if (useLogo) $(id).src = $('settings-logo').src;
    }
  }

  function status(message, error = false) {
    $('settings-status').textContent = message;
    $('settings-status').classList.toggle('error-text', error);
  }

  function clearPreviewTheme() {
    for (const variable of Object.values(CSS_VARS)) document.documentElement.style.removeProperty(variable);
  }

  function applyToPage(settings) {
    const site = settings.website;
    const text = { ...site, clanName: settings.clanName || 'Clan' };
    document.title = `${text.clanName} | ${site.title}`;
    for (const node of document.querySelectorAll('[data-brand]')) {
      const value = text[node.dataset.brand] ?? '';
      const lines = value.split('\n');
      node.replaceChildren(...lines.flatMap((line, index) => index ? [document.createElement('br'), line] : [line]));
    }
    const version = Date.now();
    document.querySelector('link[href^="/theme.css"]').href = `/theme.css?v=${version}`;
    for (const image of document.querySelectorAll('img.clan-logo')) image.src = `/logo?v=${version}`;
  }

  async function load() {
    const response = await fetch('/v1/settings', { headers: authHeader(), cache: 'no-store' });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? `HTTP ${response.status}`);
    const body = await response.json();
    current = body.settings;
    if (!defaults) {
      defaults = body.defaults;
      build();
    }
    customLogo = body.customLogo;
    logo = null;
    removeLogo = false;
    mapIcon = null;
    removeMapIcon = false;
    $('settings-map-icon').dataset.saved = `/map-icon?v=${Date.now()}`;
    $('settings-logo').dataset.saved = `/logo?v=${Date.now()}`;
    fill(current);
    changed();
    $('settings-save').disabled = !body.editable;
    if (!body.editable) status('Settings are read-only in this mode.', true);
  }

  $('preview-kind').addEventListener('change', () => preview(read()));
  $('settings-discard').addEventListener('click', () => {
    logo = null;
    removeLogo = false;
    mapIcon = null;
    removeMapIcon = false;
    fill(current);
    changed();
    status('Changes discarded.');
  });
  $('settings-reset').addEventListener('click', () => {
    fill(defaults);
    logo = null;
    removeLogo = true;
    mapIcon = null;
    removeMapIcon = true;
    changed();
    status('Defaults loaded. Press Save changes to apply them.');
  });
  $('settings-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = $('settings-save');
    button.disabled = true;
    status('Saving...');
    try {
      const response = await fetch('/v1/settings', {
        method: 'PUT',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: read(), logo: logo?.data, removeLogo, mapIcon: mapIcon?.data, removeMapIcon }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      current = body.settings;
      customLogo = body.customLogo;
      logo = null;
      removeLogo = false;
      mapIcon = null;
      removeMapIcon = false;
      $('settings-map-icon').dataset.saved = `/map-icon?v=${Date.now()}`;
      applyToPage(current);
      $('settings-logo').dataset.saved = `/logo?v=${Date.now()}`;
      fill(current);
      changed();
      clearPreviewTheme();
      status('Saved. Website and Discord settings are applied. Updated RuneLite clients refresh map icons on their next icon sync (about 30 seconds).');
    } catch (error) {
      status(`Not saved: ${error.message}`, true);
    } finally {
      button.disabled = false;
    }
  });

  return {
    async show() {
      $('settings-link').hidden = false;
      try {
        await load();
      } catch (error) {
        onError(`Could not load settings: ${error.message}`);
      }
    },
    hide() {
      $('settings-link').hidden = true;
      $('settings').hidden = true;
      clearPreviewTheme();
      status('');
    },
  };
}
