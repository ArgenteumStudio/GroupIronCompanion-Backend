const TILE_SIZE = 256;
const MIN_ZOOM = -3;
const MAX_ZOOM = 4;
const DEFAULT_CENTER = { x: 3222, y: 3218 };
const clampZoom = zoom => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));

export function visibleMembers(members, plane, now = Date.now()) {
  return members.filter(member => member.position && member.position.plane === plane &&
    now - member.updatedAt < 30000);
}

export function activePlane(members, plane, follow, autoFit, now = Date.now()) {
  const fresh = members.filter(member => member.position && now - member.updatedAt < 30000);
  const followed = fresh.find(member => member.username === follow);
  if (followed) return followed.position.plane;
  if (autoFit && !fresh.some(member => member.position.plane === plane)) {
    return fresh[0]?.position.plane ?? plane;
  }
  return plane;
}

export function screenPoint(position, center, zoom, width, height) {
  const scale = 2 ** zoom;
  return {
    x: width / 2 + (position.x - center.x) * scale,
    y: height / 2 - (position.y - center.y) * scale,
  };
}

export function fitView(positions, width, height) {
  if (!positions.length) return { center: { ...DEFAULT_CENTER }, zoom: 1 };
  const xs = positions.map(point => point.x), ys = positions.map(point => point.y);
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  const ymin = Math.min(...ys), ymax = Math.max(...ys);
  const scale = Math.min(Math.max(64, width - 160) / Math.max(1, xmax - xmin),
    Math.max(64, height - 100) / Math.max(1, ymax - ymin));
  return {
    center: { x: (xmin + xmax) / 2, y: (ymin + ymax) / 2 },
    zoom: Math.min(2, clampZoom(Math.floor(Math.log2(scale)))),
  };
}

export function visibleTiles(center, zoom, width, height) {
  const scale = 2 ** zoom;
  const left = center.x * scale - width / 2;
  const north = center.y * scale + height / 2;
  const tiles = [];
  for (let x = Math.floor(left / TILE_SIZE); x <= Math.floor((left + width) / TILE_SIZE); x++) {
    for (let y = Math.floor((north - height) / TILE_SIZE); y <= Math.floor(north / TILE_SIZE); y++) {
      if (x < 0 || y < 0) continue;
      tiles.push({ x, y, left: x * TILE_SIZE - left, top: north - (y + 1) * TILE_SIZE });
    }
  }
  return tiles;
}

export function tileUrl(template, tile, zoom, plane) {
  return template.replace('{z}', zoom).replace('{p}', plane).replace('{x}', tile.x).replace('{y}', tile.y);
}

export function initWorldMap({ viewport, tileLayer, markerLayer, status, planeSelect, zoomIn, zoomOut, fit, retry }) {
  let members = [];
  let center = { ...DEFAULT_CENTER };
  let zoom = 1;
  let plane = 0;
  let follow = null;
  let autoFit = true;
  let autoPlane = true;
  let template = null;
  let active = false;
  let loading = null;
  let drawId = 0;
  let tileKey = '';
  let tileState = { loaded: 0, failed: 0 };
  let configError = '';

  function showStatus() {
    if (configError) status.textContent = configError;
    else if (!template) status.textContent = 'Loading geographical map...';
    else if (tileState.failed) status.textContent =
      `${tileState.failed} map tile(s) unavailable. Markers still use exact game coordinates. Try reloading the map.`;
    else if (!tileState.loaded) status.textContent = 'Loading geographical map tiles...';
    else {
      const count = visibleMembers(members, plane).length;
      const fresh = members.filter(member => member.position && Date.now() - member.updatedAt < 30000);
      status.textContent = count
        ? `${count} recently synced player(s) on floor ${plane}. Drag or use arrow keys to pan; use + / - to zoom.`
        : fresh.length
          ? `Players are on another floor. Choose their floor or select Show on map below.`
          : 'No live locations. Stale markers are hidden after 30 seconds. Log in with the plugin connected and Share location enabled.';
    }
    retry.hidden = !configError && !tileState.failed;
  }

  async function loadConfig() {
    if (loading) return loading;
    configError = '';
    loading = (async () => {
      try {
        const response = await fetch('/map-config', { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const config = await response.json();
        if (config.tiles === null) {
          configError = 'Geographical maps are disabled on this server (WORLD_MAP=off).';
          template = null;
          return;
        }
        if (typeof config.tiles !== 'string' ||
            !/^https:\/\/maps\.runescape\.wiki\/osrs\/versions\/\d{4}-\d{2}-\d{2}_[a-z0-9]+\/tiles\/rendered\/-?\d+\/\{z\}\/\{p\}_\{x\}_\{y\}\.png$/.test(config.tiles)) {
          throw new Error('Invalid map tile configuration');
        }
        template = config.tiles;
      } catch (error) {
        template = null;
        configError = `Could not load the geographical map: ${error.message}.`;
      } finally {
        loading = null;
        if (active) draw();
      }
    })();
    return loading;
  }

  function draw() {
    if (!active) return;
    const width = viewport.clientWidth, height = viewport.clientHeight;
    if (!width || !height) return;
    plane = activePlane(members, plane, follow, autoPlane);
    const located = visibleMembers(members, plane);
    const followed = located.find(member => member.username === follow);
    if (followed) center = { x: followed.position.x, y: followed.position.y };
    else if (autoFit) ({ center, zoom } = fitView(located.map(member => member.position), width, height));
    planeSelect.value = String(plane);
    zoomIn.disabled = zoom >= MAX_ZOOM;
    zoomOut.disabled = zoom <= MIN_ZOOM;
    const key = JSON.stringify([template, center, zoom, plane, width, height]);
    if (key !== tileKey) {
      tileKey = key;
      const currentDraw = ++drawId;
      tileState = { loaded: 0, failed: 0 };
      tileLayer.replaceChildren();
      if (template) {
        const tiles = visibleTiles(center, zoom, width, height);
        for (const tile of tiles) {
          const image = document.createElement('img');
          image.alt = '';
          image.draggable = false;
          image.referrerPolicy = 'no-referrer';
          image.style.left = `${tile.left}px`;
          image.style.top = `${tile.top}px`;
          image.onload = () => {
            if (currentDraw !== drawId || !active) return;
            tileState.loaded++;
            showStatus();
          };
          image.onerror = () => {
            if (currentDraw !== drawId || !active) return;
            tileState.failed++;
            image.hidden = true;
            showStatus();
          };
          // Only public tile indexes are sent to the map host, never group names, keys or snapshots.
          image.src = tileUrl(template, tile, zoom, plane);
          tileLayer.append(image);
        }
      }
    }
    const markers = located.map(member => {
      const point = screenPoint(member.position, center, zoom, width, height);
      const marker = document.createElement('button');
      marker.type = 'button';
      marker.className = 'geo-pin';
      marker.textContent = member.username;
      marker.title = `${member.username} - W${member.position.world} / ${member.position.x}, ${member.position.y} / floor ${plane}`;
      marker.style.left = `${point.x}px`;
      marker.style.top = `${point.y}px`;
      marker.addEventListener('click', () => focus(member.username));
      return marker;
    });
    markerLayer.replaceChildren(...markers);
    showStatus();
  }

  function focus(name) {
    const member = members.find(member => member.username === name && member.position &&
      Date.now() - member.updatedAt < 30000);
    if (!member) return;
    plane = member.position.plane;
    follow = name;
    autoFit = false;
    zoom = Math.max(zoom, 2);
    draw();
  }

  function changeZoom(delta) {
    autoFit = false;
    zoom = clampZoom(zoom + delta);
    draw();
  }
  zoomIn.addEventListener('click', () => changeZoom(1));
  zoomOut.addEventListener('click', () => changeZoom(-1));
  fit.addEventListener('click', () => {
    follow = null;
    autoFit = true;
    autoPlane = true;
    draw();
  });
  retry.addEventListener('click', () => {
    tileKey = '';
    void loadConfig();
  });
  planeSelect.addEventListener('change', () => {
    plane = Number(planeSelect.value);
    follow = null;
    autoFit = true;
    autoPlane = false;
    draw();
  });
  viewport.addEventListener('keydown', event => {
    if (event.target !== viewport) return;
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    if (directions[event.key]) {
      event.preventDefault();
      autoFit = false;
      follow = null;
      center.x += directions[event.key][0] * 100 / 2 ** zoom;
      center.y += directions[event.key][1] * 100 / 2 ** zoom;
      draw();
    } else if (['+', '=', '-'].includes(event.key)) {
      event.preventDefault();
      changeZoom(event.key === '-' ? -1 : 1);
    }
  });
  let drag = null;
  viewport.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('button')) return;
    viewport.focus({ preventScroll: true });
    viewport.setPointerCapture(event.pointerId);
    drag = { x: event.clientX, y: event.clientY, center: { ...center } };
  });
  viewport.addEventListener('pointermove', event => {
    if (!drag) return;
    autoFit = false;
    follow = null;
    center = {
      x: drag.center.x - (event.clientX - drag.x) / 2 ** zoom,
      y: drag.center.y + (event.clientY - drag.y) / 2 ** zoom,
    };
    const offset = `translate(${event.clientX - drag.x}px, ${event.clientY - drag.y}px)`;
    tileLayer.style.transform = offset;
    markerLayer.style.transform = offset;
  });
  viewport.addEventListener('lostpointercapture', () => {
    drag = null;
    tileLayer.style.transform = '';
    markerLayer.style.transform = '';
    draw();
  });
  // Expire disconnected players even if bridge polling fails.
  let visibleNames = '';
  setInterval(() => {
    if (!active || drag) return;
    const names = JSON.stringify(visibleMembers(members, plane).map(member => member.username));
    if (names !== visibleNames) {
      visibleNames = names;
      draw();
    }
  }, 1000);
  new ResizeObserver(draw).observe(viewport);
  return {
    update(nextMembers) {
      members = nextMembers;
      const followed = members.find(member => member.username === follow && member.position &&
        Date.now() - member.updatedAt < 30000);
      if (followed) plane = followed.position.plane;
      const firstUpdate = !active;
      active = true;
      if (firstUpdate) {
        plane = members.find(member => member.position && Date.now() - member.updatedAt < 30000)?.position.plane ?? 0;
        if (!template) void loadConfig();
      }
      draw();
    },
    focus,
    clear() {
      active = false;
      members = [];
      follow = null;
      autoFit = true;
      autoPlane = true;
      center = { ...DEFAULT_CENTER };
      zoom = 1;
      plane = 0;
      drag = null;
      drawId++;
      tileKey = '';
      markerLayer.replaceChildren();
      tileLayer.replaceChildren();
      tileLayer.style.transform = '';
      markerLayer.style.transform = '';
      status.textContent = '';
    },
  };
}
