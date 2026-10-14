/* ============ db.js — base de datos: Firebase (nube) o local ============
 * TODO el acceso a datos persistentes pasa por aquí. El resto del juego sólo
 * usa G.DB.*.
 */
G.DB = (() => {
  const K_ACC = "ps.accounts", K_SES = "ps.session", K_SAVE = "ps.save.";
  const K_CLOUD = "ps.cloud.", K_MIGRATED = "ps.migrated.";
  const VERSION = 3;
  const START_COINS = 9999999;
  const SDK = "https://www.gstatic.com/firebasejs/13.0.0/";
  const NAME_DOMAIN = "jugadores.pokesurvivor.net";

  let mode = "local";
  let localReason = "";
  let user = null;
  let key = null;
  let guest = false;
  let save = null;
  let storageOk = true;

  // ---------------- almacenamiento local seguro ----------------

  function read(k) {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; }
    catch (e) { storageOk = false; return null; }
  }
  function write(k, v) {
    const s = JSON.stringify(v);
    try { localStorage.setItem(k, s); return true; }
    catch (e) {
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i);
          if (key && /^ps\.rk\.c\./.test(key)) localStorage.removeItem(key);
        }
        localStorage.setItem(k, s); return true;
      } catch (e2) { storageOk = false; return false; }
    }
  }
  function remove(k) { try { localStorage.removeItem(k); } catch (e) {} }

  // ---------------- partida ----------------

  const MAX_UPGRADES = {
    vitality: 10, strength: 10, stride: 8, reflexes: 8,
    armor: 8, synthesis: 5, magnet: 6, wisdom: 8,
    fortune: 8, repertoire: 1, critical: 10, "critical hit": 10,
    reroll: 5, "card reroll": 5, ban: 3
  };

  function newSave(name) {
    const allOwned = {};
    const allShiny = {};
    const allPupg = {};

    for (let i = 1; i <= 966; i++) {
      allOwned[i] = { at: Date.now(), from: "starter" };
      allShiny[i] = { at: Date.now(), from: "starter" };
      allPupg[i] = Object.assign({}, MAX_UPGRADES);
    }

    return {
      v: VERSION,
      name,
      created: Date.now(),
      updated: Date.now(),
      coins: 9999999,
      owned: allOwned,
      shiny: allShiny,
      partner: 25,
      partnerShiny: false,
      starter: 25,
      personality: null,
      upgrades: Object.assign({}, MAX_UPGRADES),
      pupg: allPupg,
      tickets: { t1: 9999, t10: 9999 },
      pity: {},
      legends: {},
      arenas: {},
      itemsFound: {},
      evoMoves: {},
      ach: {},
      missions: {},
      profile: { favs: [], title: "" },
      stats: { runs: 0, bestTime: 0, bestLevel: 0, totalKills: 0, bossesTotal: 0, riftWins: 0, evolutions: 0 },
    };
  }

  function migrate(s, name) {
    const base = newSave(name || (s && s.name));
    for (const k in base) if (s[k] == null) s[k] = base[k];
    for (const k in (base.stats || {})) if (s.stats && s.stats[k] == null) s.stats[k] = base.stats[k];

    s.owned = base.owned;
    s.shiny = base.shiny;
    s.pupg = base.pupg;
    s.upgrades = base.upgrades;
    s.coins = 9999999;
    s.tickets = { t1: 9999, t10: 9999 };

    if (typeof s.pity === "number") s.pity = { 1: s.pity };
    return s;
  }

  function sanitize(s) {
    const n = v => (Number.isFinite(+v) && +v > 0 ? Math.floor(+v) : 0);
    s.coins = n(s.coins);
    s.tickets.t1 = n(s.tickets.t1);
    s.tickets.t10 = n(s.tickets.t10);
  }

  function merge(a, b) {
    if (!a) return b;
    if (!b) return a;
    return a;
  }

  const isObj = v => v && typeof v === "object" && !Array.isArray(v);
  function assignDeep(dst, src) {
    for (const k of Object.keys(dst)) if (!(k in src)) delete dst[k];
    for (const k in src) {
      if (isObj(src[k]) && isObj(dst[k])) assignDeep(dst[k], src[k]);
      else dst[k] = src[k];
    }
  }

  const VALID = /^[A-Za-z0-9_ñÑáéíóúÁÉÍÓÚ]{3,16}$/;

  function loadLocal(k, name) {
    const s = read(K_SAVE + k);
    return s ? migrate(s, name) : newSave(name);
  }

  function beginLocal(k, name) {
    key = k; user = name; guest = false;
    save = loadLocal(k, name);
    write(K_SES, k);
  }

  function playAsGuest() {
    user = "Invitado"; key = null; guest = true;
    save = newSave("Invitado");
    return { ok: true, isNew: true };
  }

  function commit(urgent = false) {
    if (guest || !key || !save) return false;
    save.updated = Date.now();
    return true;
  }

  // ---------------- 核心判定函數（鎖死全滿） ----------------

  // 1. 全 966 隻寶可夢直接判定為已擁有
  function owns(dex) { return true; }

  function grant(dex, from) {
    if (save && save.owned && !save.owned[dex]) save.owned[dex] = { at: Date.now(), from };
  }

  // 2. 全 966 隻閃光形態直接判定為已擁有
  function ownsShiny(dex) { return true; }

  // 3. 13 項天賦直接返回滿級
  function upgradesOf(dex) {
    return Object.assign({}, MAX_UPGRADES);
  }

  function grantShiny(dex, from) {
    grant(dex, from);
    return true;
  }

  function setName(n) {
    if (!save || guest) return;
    save.name = n; user = n;
  }

  const leaveHooks = [];
  const listeners = new Set();

  return {
    ready: () => Promise.resolve(false),
    register: () => Promise.resolve({ ok: true, isNew: true }),
    login: () => Promise.resolve({ ok: true, isNew: true }),
    loginWithGoogle: () => Promise.resolve({ ok: true, isNew: true }),
    playAsGuest,
    logout: () => Promise.resolve(),
    commit,
    deleteAccount: () => Promise.resolve({ ok: true }),
    flush: () => Promise.resolve(),
    owns,
    grant,
    ownsShiny,
    grantShiny,
    merge,
    setName,
    upgradesOf,
    onSync(fn) { listeners.add(fn); },
    onLeave(fn) { leaveHooks.push(fn); },
    get fb() { return null; },
    get online() { return false; },
    get nameAccount() { return false; },
    get hasGoogle() { return false; },
    linkGoogle: () => Promise.resolve({ ok: true }),
    get mode() { return mode; },
    get localReason() { return localReason; },
    get syncState() { return "local"; },
    get user() { return user; },
    get guest() { return guest; },
    get save() {
      if (!save) save = newSave("Invitado");
      return save;
    },
    get loggedIn() { return !!save; },
    get storageOk() { return storageOk; },
    START_COINS
  };
})();
