const $ = id => document.getElementById(id);
const node = (tag, text, className = '') => Object.assign(document.createElement(tag), { textContent: text, className });
const PERMISSIONS = { banks: 'Personal banks', storage: 'Group storage', stats: 'Stats / XP', locations: 'Locations', activity: 'Activity / chat' };

export function initMemberAccess({ authHeader }) {
  let generation = 0;
  let active = false;
  let busy = false;
  let viewer;

  function status(message, error = false) {
    $('member-access-status').textContent = message;
    $('member-access-status').classList.toggle('error-text', error);
  }

  function clearKey() {
    $('member-token-key').value = '';
    $('member-token-result').hidden = true;
    $('member-token-recipient').textContent = '';
  }

  async function request(path, method = 'GET', body) {
    const response = await fetch(`/v1/member-tokens${path}`, {
      method, cache: 'no-store',
      headers: { ...authHeader(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
    return result;
  }

  function render(tokens) {
    $('member-token-list').replaceChildren(...tokens.map(token => {
      const row = node('div', '', 'member-token-row');
      const details = node('div', '', 'member-token-details');
      details.append(node('strong', `${token.name} / ${token.role === 'manager' ? 'Manager' : 'Member'}`),
        node('small', `Created ${new Date(token.createdAt).toLocaleString()}${token.rotatedAt ? ` / Replaced ${new Date(token.rotatedAt).toLocaleString()}` : ''}`));
      const actions = node('div', '', 'member-token-actions');
      const editable = viewer.role === 'owner' || token.role !== 'manager';
      for (const [label, method] of [['Replace token', 'PUT'], ['Kick member', 'DELETE']]) {
        const button = node('button', label, 'quiet');
        button.type = 'button';
        button.disabled = !editable || (method === 'PUT' && viewer.role !== 'owner' &&
          Object.keys(PERMISSIONS).some(key => token.permissions[key] && !viewer.permissions[key]));
        button.addEventListener('click', () => {
          if (!window.confirm(`${label} for ${token.name}? Their current token will immediately stop working.`)) return;
          void mutate(`/${token.id}`, method, method === 'PUT' ? {} : undefined);
        });
        actions.append(button);
      }
      if (viewer.role === 'owner') {
        const promote = node('button', token.role === 'manager' ? 'Demote to member' : 'Promote to manager', 'quiet');
        promote.type = 'button';
        promote.addEventListener('click', () => {
          if (!window.confirm(`${promote.textContent}: ${token.name}? Their current token will gain or lose group management authority.`)) return;
          void mutate(`/${token.id}`, 'PATCH', { role: token.role === 'manager' ? 'member' : 'manager' });
        });
        actions.append(promote);
      }
      const permissions = node('fieldset', '', 'member-permissions');
      permissions.append(node('legend', `What ${token.name} can see`));
      const switches = {};
      for (const [key, title] of Object.entries(PERMISSIONS)) {
        const label = node('label', '', 'check');
        const input = Object.assign(document.createElement('input'), {
          type: 'checkbox', checked: token.permissions[key],
          disabled: !editable || (viewer.role !== 'owner' && !viewer.permissions[key] && !token.permissions[key]),
        });
        input.addEventListener('change', () => {
          if (viewer.role !== 'owner' && !viewer.permissions[key] && !input.checked) input.disabled = true;
        });
        switches[key] = input;
        label.append(input, node('span', title));
        permissions.append(label);
      }
      const save = node('button', 'Save viewing permissions', 'quiet');
      save.type = 'button';
      save.disabled = !editable;
      save.addEventListener('click', () => void mutate(`/${token.id}`, 'PATCH', {
        permissions: Object.fromEntries(Object.entries(switches).map(([key, input]) => [key, input.checked])),
      }));
      permissions.append(save);
      row.append(details, actions, permissions);
      return row;
    }));
    $('member-token-empty').hidden = tokens.length > 0;
  }

  async function mutate(path, method, body) {
    if (!active || busy) return;
    const expected = generation;
    busy = true;
    $('member-token-create').disabled = true;
    clearKey();
    status('Updating member access...');
    let updated = false;
    try {
      const result = await request(path, method, body);
      if (!active || expected !== generation) return;
      updated = true;
      if (result.key) {
        $('member-token-recipient').textContent = `Private token for ${result.name}`;
        $('member-token-key').value = result.key;
        $('member-token-result').hidden = false;
        $('member-token-name').value = '';
      }
      status(result.key
        ? 'Token saved. Copy it now and send it privately to this member. It cannot be retrieved later.'
        : method === 'DELETE' ? 'Member kicked and token revoked. This character is no longer included in the dashboard.'
          : 'Member role or viewing permissions updated.');
      const list = await request('');
      if (active && expected === generation) render(list.tokens);
    } catch (error) {
      if (active && expected === generation) status(`${updated ? 'Access updated, but the list could not refresh' : 'Access not updated'}: ${error.message}`, true);
    } finally {
      if (expected === generation) {
        busy = false;
        $('member-token-create').disabled = false;
      }
    }
  }

  $('member-token-form').addEventListener('submit', event => {
    event.preventDefault();
    void mutate('', 'POST', { name: $('member-token-name').value });
  });
  $('member-token-dismiss').addEventListener('click', clearKey);
  $('member-token-copy').addEventListener('click', async () => {
    const expected = generation;
    try {
      await navigator.clipboard.writeText($('member-token-key').value);
      if (active && expected === generation) status('Copied. Send this member token privately, not in a public Discord channel.');
    } catch (error) {
      if (active && expected === generation) status(`Clipboard unavailable: ${error.message}. Select the displayed token and copy it manually.`, true);
    }
  });

  return {
    async show(access) {
      viewer = access;
      active = true;
      const expected = ++generation;
      busy = false;
      clearKey();
      $('member-token-create').disabled = false;
      status('Loading member access...');
      $('manage-group-link').hidden = false;
      $('group-management-role').textContent = viewer.role === 'owner'
        ? 'Owner: manage invitations, managers and member viewing permissions.'
        : 'Manager: manage regular members only. You cannot grant access beyond your own viewing permissions.';
      try {
        const result = await request('');
        if (active && expected === generation) {
          render(result.tokens);
          status('');
        }
      } catch (error) {
        if (active && expected === generation) status(`Could not load member access: ${error.message}`, true);
      }
    },
    hide() {
      $('manage-group-link').hidden = true;
      $('manage-group').hidden = true;
      active = false;
      generation++;
      busy = false;
      clearKey();
      $('member-token-list').replaceChildren();
      $('member-token-name').value = '';
      status('');
    },
  };
}
