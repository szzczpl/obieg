/* Obieg – wspólny interfejs wszystkich stron */
(() => {
  const DB = window.DB;
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // ---------- Helpers ----------
  const zl = n => Number(n).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' zł';
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const plural = (n, one, few, many) => n === 1 ? one : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? few : many;
  const initials = p => ((p && (p.display_name || p.username)) || '?').trim().charAt(0).toUpperCase();
  const avatar = (p, cls = '') => p && p.avatar_url
    ? `<span class="avatar ${cls}"><img src="${esc(p.avatar_url)}" alt="" loading="lazy"></span>`
    : `<span class="avatar ${cls}" aria-hidden="true">${esc(initials(p))}</span>`;
  const heart = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20C7 16 3.5 13 3.5 9A4.25 4.25 0 0 1 12 7.2 4.25 4.25 0 0 1 20.5 9c0 4-3.5 7-8.5 11Z"/></svg>';
  const STATUS = { reserved: 'Zarezerwowane', sold: 'Sprzedane', hidden: 'Ukryte' };
  const next = () => encodeURIComponent(location.pathname.split('/').pop() + location.search + location.hash);
  const toLogin = () => { location.href = 'logowanie.html?next=' + next(); };

  function toast(msg, kind = '') {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.dataset.kind = kind;
    t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ---------- Photos fade in when loaded ----------
  const markLoaded = i => i.classList.add('loaded');
  document.addEventListener('load', e => { if (e.target.tagName === 'IMG') markLoaded(e.target); }, true);
  document.addEventListener('error', e => { if (e.target.tagName === 'IMG' && e.target.closest('.item-photo,.pdp-photo,.thumbs-strip')) e.target.remove(); }, true);
  const sweep = () => $$('img').forEach(i => { if (i.complete && i.naturalWidth) markLoaded(i); });
  sweep(); addEventListener('DOMContentLoaded', sweep);

  // ---------- Favourites ----------
  const favs = new Set();
  let favsReady = DB.favIds().then(ids => { ids.forEach(i => favs.add(i)); paintFavs(); }).catch(() => {});
  const isFav = id => favs.has(Number(id));
  function paintFavs() {
    $$('[data-fav]').forEach(b => {
      const on = isFav(b.dataset.fav);
      b.setAttribute('aria-pressed', String(on));
      if (b.hasAttribute('data-label')) b.lastChild.textContent = on ? ' W ulubionych' : ' Dodaj do ulubionych';
    });
  }
  const bump = (id, d) => $$(`[data-fav="${id}"] span`).forEach(n => n.textContent = Math.max(0, Number(n.textContent) + d));
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-fav]');
    if (!b) return;
    e.preventDefault();
    if (!(await DB.me())) return toLogin();
    const id = Number(b.dataset.fav), on = !isFav(id);
    on ? favs.add(id) : favs.delete(id);
    paintFavs(); bump(id, on ? 1 : -1);
    document.dispatchEvent(new CustomEvent('favs:change', { detail: { id, on } }));
    try { await DB.setFav(id, on); if (on) toast('Dodano do ulubionych'); }
    catch (err) { on ? favs.delete(id) : favs.add(id); paintFavs(); bump(id, on ? -1 : 1); toast(err.message, 'error'); }
  });

  // ---------- Listing card ----------
  function card(x, likes = {}, opts = {}) {
    const href = `oferta.html?id=${x.id}`;
    const photo = x.photos && x.photos[0];
    const st = STATUS[x.status];
    return `<li class="item${x.status !== 'active' ? ' is-' + x.status : ''}">
      <div class="item-photo">
        <a href="${href}" tabindex="-1" aria-hidden="true">${photo ? `<img src="${esc(photo)}" width="600" height="800" alt="${esc(x.title)}" loading="lazy" decoding="async">` : ''}</a>
        ${st ? `<span class="status-tag">${st}</span>` : ''}
        ${opts.noFav ? '' : `<button type="button" class="fav" data-fav="${x.id}" aria-pressed="${isFav(x.id)}" aria-label="Ulubione: ${esc(x.title)}">${heart}<span>${likes[x.id] || 0}</span></button>`}
      </div>
      <a class="item-body" href="${href}">
        <span class="item-brand">${esc(x.brand)}</span>
        <span class="item-title">${esc(x.title)}</span>
        <span class="item-meta">${esc(x.size)} · ${esc(x.condition)}</span>
        <span class="item-price">${zl(x.price)}</span>
      </a>
    </li>`;
  }
  async function render(el, list, empty, opts = {}) {
    let likes = {};
    try { likes = await DB.likes(list.map(x => x.id)); } catch (_) {}
    el.innerHTML = list.length ? list.map(x => card(x, likes, opts)).join('') : `<li class="empty">${empty || 'Nic tu jeszcze nie ma.'}</li>`;
    $$('img', el).forEach(i => { if (i.complete && i.naturalWidth) markLoaded(i); });
    if (el.classList.contains('rail')) el.scrollLeft = 0;
  }
  function skeleton(el, n = 5) {
    el.innerHTML = Array.from({ length: n }, () => '<li class="item sk"><div class="item-photo"></div><div class="item-body"><span class="sk-line"></span><span class="sk-line short"></span></div></li>').join('');
  }

  window.UI = { zl, esc, plural, avatar, initials, card, render, skeleton, toast, isFav, favs, favsReady, toLogin, STATUS };

  // ---------- Rail arrows ----------
  $$('[data-rail]').forEach(b => b.addEventListener('click', () => {
    const rail = document.getElementById(b.dataset.target || 'rail');
    rail.scrollBy({ left: rail.clientWidth * .8 * Number(b.dataset.rail), behavior: 'smooth' });
  }));

  // ---------- Header: signed-in state ----------
  DB.me().then(me => {
    if (!me) return;
    $$('[data-auth-login]').forEach(a => a.hidden = true);
    $$('[data-auth-cta]').forEach(a => {
      a.className = 'me-chip';
      a.href = 'konto.html';
      a.innerHTML = `${avatar(me, 'sm')}<span>${esc(me.username || 'Moje konto')}</span>`;
      a.setAttribute('aria-label', 'Moje konto');
    });
  }).catch(() => {});

  // ---------- Header shadow ----------
  const top = document.querySelector('.top');
  if (top) {
    let t = false;
    addEventListener('scroll', () => { if (!t) { t = true; requestAnimationFrame(() => { top.classList.toggle('scrolled', scrollY > 8); t = false; }); } }, { passive: true });
  }

  // ---------- Simple dialogs ----------
  document.addEventListener('click', e => {
    const o = e.target.closest('[data-open]');
    if (o) { e.preventDefault(); document.getElementById(o.dataset.open)?.showModal(); }
    const c = e.target.closest('[data-close]');
    if (c) c.closest('dialog')?.close();
  });
  $$('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));

  // ---------- Bottom tab bar (phones) ----------
  const page = (location.pathname.split('/').pop() || 'index.html').replace('.html', '') || 'index';
  const T = [
    ['index', 'index.html', 'Główna', '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>'],
    ['katalog', 'katalog.html', 'Szukaj', '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/>'],
    ['wystaw', 'wystaw.html', 'Sprzedaj', '<path d="M12 5v14M5 12h14"/>'],
    ['ulubione', 'ulubione.html', 'Ulubione', '<path d="M12 20C7 16 3.5 13 3.5 9A4.25 4.25 0 0 1 12 7.2 4.25 4.25 0 0 1 20.5 9c0 4-3.5 7-8.5 11Z"/>'],
    ['konto', 'konto.html', 'Konto', '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>']
  ];
  if (!document.body.classList.contains('no-tabbar')) {
    const tabs = document.createElement('nav');
    tabs.className = 'tabbar';
    tabs.setAttribute('aria-label', 'Nawigacja');
    tabs.innerHTML = T.map(([id, href, label, icon]) => {
      const cur = id === page || (id === 'konto' && (page === 'logowanie' || page === 'profil'));
      return `<a href="${href}" class="tab-${id}"${cur ? ' aria-current="page"' : ''}><span class="ti"><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg></span>${label}</a>`;
    }).join('');
    document.body.appendChild(tabs);
  }

  // ---------- Install as an app ----------
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) document.documentElement.classList.add('standalone');
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  const DKEY = 'obieg-install-dismissed';
  let dismissed = false; try { dismissed = !!localStorage.getItem(DKEY); } catch (_) {}
  function banner(html, onAction) {
    const b = document.createElement('div');
    b.className = 'install';
    b.setAttribute('role', 'dialog');
    b.setAttribute('aria-label', 'Zainstaluj Obieg');
    b.innerHTML = `<img src="apple-touch-icon.png" width="44" height="44" alt=""><div>${html}</div>${onAction ? '<button type="button" class="btn btn-brand" data-act>Zainstaluj</button>' : ''}<button type="button" class="install-x" aria-label="Zamknij">×</button>`;
    b.querySelector('.install-x').addEventListener('click', () => { b.remove(); try { localStorage.setItem(DKEY, '1'); } catch (_) {} });
    if (onAction) b.querySelector('[data-act]').addEventListener('click', onAction);
    document.body.appendChild(b);
    requestAnimationFrame(() => b.classList.add('show'));
    return b;
  }
  if (!standalone && !dismissed && matchMedia('(max-width:720px)').matches && page === 'index') {
    if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
      setTimeout(() => banner('<b>Obieg jak aplikacja</b><span>Stuknij <svg class="share" viewBox="0 0 24 24" aria-label="Udostępnij"><path d="M12 3v12M8 7l4-4 4 4M5 11v9h14v-9"/></svg> i wybierz „Do ekranu początk.”</span>'), 2500);
    } else {
      addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        const b = banner('<b>Obieg jak aplikacja</b><span>Szybki dostęp z ekranu telefonu.</span>', async () => { e.prompt(); await e.userChoice; b.remove(); });
      });
    }
  }
})();
