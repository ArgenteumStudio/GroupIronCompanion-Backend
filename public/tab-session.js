const KEY = 'bowlsofmayo-tab-access';

export function tabSession(storage) {
  return {
    load() {
      const token = storage.getItem(KEY) ?? '';
      if (token && !/^[a-f0-9]{64}$/i.test(token)) {
        storage.removeItem(KEY);
        throw new Error('Invalid stored access was cleared. Unlock this tab again.');
      }
      return token;
    },
    save(token) {
      if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error('Expected a 64-character hexadecimal access key.');
      storage.setItem(KEY, token);
    },
    clear() { storage.removeItem(KEY); },
  };
}
