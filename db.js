/* Obieg – warstwa danych (Supabase). Wszystkie strony korzystają z window.DB. */
(() => {
  const cfg = window.OBIEG_CONFIG || {};
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  const base = location.href.replace(/[^/]*([?#].*)?$/, '');

  const MESSAGES = [
    [/already registered|already exists|duplicate key.*email/i, 'Konto z tym adresem już istnieje. Zaloguj się albo zresetuj hasło.'],
    [/duplicate key.*username|profiles_username_key/i, 'Ta nazwa użytkownika jest już zajęta.'],
    [/invalid login credentials/i, 'Nieprawidłowy e-mail lub hasło.'],
    [/email not confirmed/i, 'Najpierw potwierdź adres e-mail. Link wysłaliśmy po rejestracji.'],
    [/password.*(at least|short|weak)/i, 'Hasło jest za słabe. Użyj co najmniej 8 znaków.'],
    [/rate limit|too many/i, 'Za dużo prób. Spróbuj ponownie za kilka minut.'],
    [/failed to fetch|network/i, 'Brak połączenia. Sprawdź internet i spróbuj ponownie.'],
    [/username.*check|profiles_username_check/i, 'Nazwa może mieć 3–20 znaków: małe litery, cyfry, kropka i podkreślnik.'],
    [/Kwota przekracza|Zaloguj się ponownie/i, null],
    [/payload too large|exceeded the maximum/i, 'Zdjęcie jest za duże. Wybierz mniejsze.']
  ];
  function fail(error) {
    const msg = (error && (error.message || error.error_description)) || '';
    for (const [re, pl] of MESSAGES) if (re.test(msg)) return new Error(pl || msg);
    return new Error('Coś poszło nie tak. Spróbuj ponownie za chwilę.');
  }
  const must = ({ data, error }) => { if (error) throw fail(error); return data; };

  // Zmniejsza zdjęcie w przeglądarce przed wysłaniem (szybciej, mniej miejsca)
  async function shrink(file, max, quality = 0.82) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return await new Promise(ok => c.toBlob(ok, 'image/jpeg', quality));
    } catch (_) { return file; } finally { URL.revokeObjectURL(url); }
  }
  const rid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  async function upload(bucket, uid, blob) {
    const path = `${uid}/${rid()}.jpg`;
    must(await sb.storage.from(bucket).upload(path, blob, { contentType: 'image/jpeg', upsert: false }));
    return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  }

  let meCache;
  const DB = {
    client: sb,

    // ---------- Konto ----------
    async session() { return (await sb.auth.getSession()).data.session; },
    async me(fresh) {
      if (meCache !== undefined && !fresh) return meCache;
      const s = await DB.session();
      if (!s) return (meCache = null);
      const p = must(await sb.from('profiles').select('*').eq('id', s.user.id).maybeSingle());
      return (meCache = p ? { ...p, email: s.user.email } : { id: s.user.id, email: s.user.email, username: '' });
    },
    async usernameFree(u) {
      const rows = must(await sb.from('profiles').select('id').eq('username', u.toLowerCase()).limit(1));
      const s = await DB.session();
      return !rows.length || (s && rows[0].id === s.user.id);
    },
    async signUp({ email, password, username, displayName, marketing }) {
      const data = must(await sb.auth.signUp({ email, password, options: {
        emailRedirectTo: base + 'konto.html', data: { username: username.toLowerCase(), display_name: displayName || '', marketing: !!marketing } } }));
      if (data.user && data.user.identities && data.user.identities.length === 0)
        throw new Error('Konto z tym adresem już istnieje. Zaloguj się albo zresetuj hasło.');
      meCache = undefined;
      return { confirmationRequired: !data.session };
    },
    async signIn(email, password) { must(await sb.auth.signInWithPassword({ email, password })); meCache = undefined; },
    async signOut() { await sb.auth.signOut(); meCache = null; },
    async resetPassword(email) { must(await sb.auth.resetPasswordForEmail(email, { redirectTo: base + 'konto.html#nowe-haslo' })); },
    async updatePassword(password) { must(await sb.auth.updateUser({ password })); },
    onRecovery(cb) { sb.auth.onAuthStateChange(ev => { if (ev === 'PASSWORD_RECOVERY') cb(); }); },

    // ---------- Profile ----------
    async updateProfile(fields) {
      const me = await DB.me();
      const row = must(await sb.from('profiles').update(fields).eq('id', me.id).select().single());
      meCache = { ...row, email: me.email };
      return meCache;
    },
    async uploadAvatar(file) {
      const me = await DB.me();
      const url = await upload('avatars', me.id, await shrink(file, 400, 0.85));
      return DB.updateProfile({ avatar_url: url });
    },
    async profileByUsername(u) { return must(await sb.from('profiles').select('*').eq('username', u.toLowerCase()).maybeSingle()); },
    async profilesByIds(ids) {
      if (!ids.length) return [];
      return must(await sb.from('profiles').select('id,username,display_name,avatar_url,city').in('id', [...new Set(ids)]));
    },

    // ---------- Ogłoszenia ----------
    async latest(limit = 24) {
      return must(await sb.from('listings').select('*').eq('status', 'active').order('created_at', { ascending: false }).limit(limit));
    },
    async listing(id) { return must(await sb.from('listings').select('*').eq('id', id).maybeSingle()); },
    async bySeller(uid, statuses = ['active']) {
      return must(await sb.from('listings').select('*').eq('seller_id', uid).in('status', statuses).order('created_at', { ascending: false }));
    },
    async byIds(ids) {
      if (!ids.length) return [];
      return must(await sb.from('listings').select('*').in('id', ids));
    },
    async likes(ids) {
      if (!ids.length) return {};
      const rows = must(await sb.from('listing_likes').select('*').in('listing_id', ids));
      return Object.fromEntries(rows.map(r => [r.listing_id, r.likes]));
    },
    async uploadPhotos(files, onProgress) {
      const me = await DB.me();
      const urls = [];
      for (let i = 0; i < files.length; i++) {
        urls.push(await upload('listing-photos', me.id, await shrink(files[i], 1400)));
        onProgress && onProgress(i + 1, files.length);
      }
      return urls;
    },
    async createListing(fields) {
      const me = await DB.me();
      return must(await sb.from('listings').insert({ ...fields, seller_id: me.id }).select().single());
    },
    async updateListing(id, fields) { return must(await sb.from('listings').update(fields).eq('id', id).select().single()); },
    async deleteListing(id) { must(await sb.from('listings').delete().eq('id', id)); },

    // ---------- Ulubione ----------
    async favIds() {
      const me = await DB.me(); if (!me) return [];
      return must(await sb.from('favorites').select('listing_id').eq('user_id', me.id)).map(r => r.listing_id);
    },
    async setFav(id, on) {
      const me = await DB.me();
      if (on) must(await sb.from('favorites').insert({ user_id: me.id, listing_id: id }));
      else must(await sb.from('favorites').delete().eq('user_id', me.id).eq('listing_id', id));
    },

    // ---------- Portfel ----------
    async wallet() {
      const me = await DB.me();
      const tx = must(await sb.from('wallet_transactions').select('*').eq('user_id', me.id).order('created_at', { ascending: false }));
      const payouts = must(await sb.from('payout_requests').select('*').eq('user_id', me.id).order('created_at', { ascending: false }));
      const sum = st => tx.filter(t => t.status === st).reduce((a, t) => a + Number(t.amount), 0);
      return { available: sum('available'), pending: sum('pending'), transactions: tx, payouts };
    },
    async requestPayout(amount, iban, holder) {
      return must(await sb.rpc('request_payout', { p_amount: amount, p_iban: iban, p_holder: holder }));
    }
  };
  window.DB = DB;
})();
