// Liar's Map: puzzle generation and solving.
// Works in the browser (window.LiarsMap) and in Node (module.exports) for testing.
(function (root) {
  'use strict';

  // ---------- seeded RNG ----------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
  function shuffle(rng, arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- content ----------
  const TERRAINS = {
    sand:   { label: 'Sand',   on: 'on the sand',        off: 'not on the sand' },
    jungle: { label: 'Jungle', on: 'in the jungle',      off: 'not in the jungle' },
    rocks:  { label: 'Rocks',  on: 'among the rocks',    off: 'not among the rocks' },
    marsh:  { label: 'Marsh',  on: 'in the marsh',       off: 'not in the marsh' },
  };
  const TERRAIN_KEYS = Object.keys(TERRAINS);

  const LANDMARKS = [
    { id: 'palm',  name: 'Lone Palm',  icon: '🌴' },
    { id: 'head',  name: 'Stone Head', icon: '🗿' },
    { id: 'wreck', name: 'Shipwreck',  icon: '⚓' },
    { id: 'hut',   name: 'Old Hut',    icon: '🛖' },
    { id: 'skull', name: 'Skull Rock', icon: '💀' },
    { id: 'fire',  name: 'Campfire',   icon: '🔥' },
  ];

  const PEOPLE = [
    { name: 'Pip',    icon: '🦜' },
    { name: 'Old Mo', icon: '🐢' },
    { name: 'Snip',   icon: '🦀' },
    { name: 'Coco',   icon: '🐒' },
    { name: 'Inky',   icon: '🐙' },
  ];

  const DIFFICULTY = {
    easy:   { size: 5, people: 3, liars: [1],    landmarks: 3, maxPer: 2, personBias: 0.25 },
    normal: { size: 6, people: 4, liars: [1, 2], landmarks: 4, maxPer: 2, personBias: 0.35 },
    hard:   { size: 6, people: 5, liars: [2],    landmarks: 4, maxPer: 2, personBias: 0.45 },
  };

  // ---------- map ----------
  const cheb = (r1, c1, r2, c2) => Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2));

  function buildMap(rng, cfg) {
    const n = cfg.size;
    // Voronoi patches: one seed per terrain plus one extra, so each terrain shows up.
    let terrain;
    for (let tries = 0; tries < 50; tries++) {
      const kinds = shuffle(rng, TERRAIN_KEYS.concat([pick(rng, TERRAIN_KEYS)]));
      const seeds = kinds.map((k) => ({ k, r: rng() * n, c: rng() * n }));
      terrain = [];
      for (let r = 0; r < n; r++) {
        const row = [];
        for (let c = 0; c < n; c++) {
          let best = null, bd = Infinity;
          for (const s of seeds) {
            const d = (s.r - r - 0.5) ** 2 + (s.c - c - 0.5) ** 2;
            if (d < bd) { bd = d; best = s.k; }
          }
          row.push(best);
        }
        terrain.push(row);
      }
      const counts = {};
      terrain.flat().forEach((k) => (counts[k] = (counts[k] || 0) + 1));
      if (TERRAIN_KEYS.every((k) => (counts[k] || 0) >= 3)) break;
    }

    const landmarks = [];
    const pool = shuffle(rng, LANDMARKS);
    for (let tries = 0; landmarks.length < cfg.landmarks && tries < 500; tries++) {
      const r = Math.floor(rng() * n), c = Math.floor(rng() * n);
      if (landmarks.some((l) => cheb(l.r, l.c, r, c) < 2)) continue;
      landmarks.push({ ...pool[landmarks.length], r, c });
    }
    return { size: n, terrain, landmarks };
  }

  const isLandmark = (map, r, c) => map.landmarks.some((l) => l.r === r && l.c === c);

  function openTiles(map) {
    const out = [];
    for (let r = 0; r < map.size; r++)
      for (let c = 0; c < map.size; c++) if (!isLandmark(map, r, c)) out.push([r, c]);
    return out;
  }

  // ---------- statements ----------
  // Location statements depend only on the treasure tile.
  // Person statements depend only on who lies (roles[i] === true means i lies).
  function locationStatements(map) {
    const out = [];
    map.landmarks.forEach((_, i) => {
      for (const d of ['N', 'S', 'E', 'W']) out.push({ k: 'dir', d, lm: i });
      out.push({ k: 'near', lm: i });
      out.push({ k: 'within2', lm: i });
    });
    for (const t of TERRAIN_KEYS) {
      out.push({ k: 'on', t });
      out.push({ k: 'off', t });
    }
    for (const h of ['N', 'S', 'E', 'W']) out.push({ k: 'half', h });
    out.push({ k: 'coast' });
    out.push({ k: 'inland' });
    return out;
  }

  function personStatements(speaker, count) {
    const out = [];
    for (let j = 0; j < count; j++) {
      if (j === speaker) continue;
      out.push({ k: 'liar', p: j }, { k: 'honest', p: j }, { k: 'same', p: j }, { k: 'diff', p: j });
      for (let m = j + 1; m < count; m++) if (m !== speaker) out.push({ k: 'oneOf', p: j, q: m });
    }
    return out;
  }

  function evalStmt(map, st, speaker, r, c, roles) {
    const n = map.size;
    switch (st.k) {
      case 'dir': {
        const l = map.landmarks[st.lm];
        return st.d === 'N' ? r < l.r : st.d === 'S' ? r > l.r : st.d === 'E' ? c > l.c : c < l.c;
      }
      case 'near':    { const l = map.landmarks[st.lm]; return cheb(r, c, l.r, l.c) <= 1; }
      case 'within2': { const l = map.landmarks[st.lm]; return cheb(r, c, l.r, l.c) <= 2; }
      case 'on':  return map.terrain[r][c] === st.t;
      case 'off': return map.terrain[r][c] !== st.t;
      case 'half': {
        const h = n / 2;
        return st.h === 'N' ? r < h : st.h === 'S' ? r >= h : st.h === 'E' ? c >= h : c < h;
      }
      case 'coast':  return r === 0 || c === 0 || r === n - 1 || c === n - 1;
      case 'inland': return !(r === 0 || c === 0 || r === n - 1 || c === n - 1);
      case 'liar':   return roles[st.p];
      case 'honest': return !roles[st.p];
      case 'same':   return roles[st.p] === roles[speaker];
      case 'diff':   return roles[st.p] !== roles[speaker];
      case 'oneOf':  return roles[st.p] !== roles[st.q];
    }
    throw new Error('unknown statement ' + st.k);
  }

  const isPersonStmt = (st) => ['liar', 'honest', 'same', 'diff', 'oneOf'].includes(st.k);
  const stmtKey = (st) => JSON.stringify(st);

  function stmtText(map, people, st) {
    const L = (i) => 'the ' + map.landmarks[i].name;
    const P = (i) => people[i].name;
    const dirWord = { N: 'north', S: 'south', E: 'east', W: 'west' };
    const halfWord = { N: 'northern', S: 'southern', E: 'eastern', W: 'western' };
    switch (st.k) {
      case 'dir':     return `The treasure is ${dirWord[st.d]} of ${L(st.lm)}.`;
      case 'near':    return `The treasure is right next to ${L(st.lm)}.`;
      case 'within2': return `The treasure is within 2 steps of ${L(st.lm)}.`;
      case 'on':      return `The treasure is ${TERRAINS[st.t].on}.`;
      case 'off':     return `The treasure is ${TERRAINS[st.t].off}.`;
      case 'half':    return `The treasure is in the ${halfWord[st.h]} half of the island.`;
      case 'coast':   return 'The treasure is on the coast.';
      case 'inland':  return 'The treasure is not on the coast.';
      case 'liar':    return `${P(st.p)} is a liar.`;
      case 'honest':  return `${P(st.p)} always tells the truth.`;
      case 'same':    return `${P(st.p)} is as honest as I am.`;
      case 'diff':    return `${P(st.p)} and I are not the same kind.`;
      case 'oneOf':   return `Exactly one of ${P(st.p)} and ${P(st.q)} is a liar.`;
    }
  }

  // ---------- solver ----------
  // Returns every (liar assignment, tile) pair consistent with all statements.
  function solve(map, islanders, liarCount, tiles) {
    const n = islanders.length;
    const solutions = [];
    for (let mask = 0; mask < 1 << n; mask++) {
      let bits = 0;
      for (let i = 0; i < n; i++) if (mask & (1 << i)) bits++;
      if (bits !== liarCount) continue;
      const roles = islanders.map((_, i) => !!(mask & (1 << i)));
      // Person statements first: they don't depend on the tile.
      let ok = true;
      for (let i = 0; i < n && ok; i++)
        for (const st of islanders[i].statements)
          if (isPersonStmt(st) && evalStmt(map, st, i, 0, 0, roles) === roles[i]) { ok = false; break; }
      if (!ok) continue;
      for (const [r, c] of tiles) {
        let good = true;
        for (let i = 0; i < n && good; i++)
          for (const st of islanders[i].statements)
            if (!isPersonStmt(st) && evalStmt(map, st, i, r, c, roles) === roles[i]) { good = false; break; }
        if (good) solutions.push({ roles, r, c });
      }
    }
    return solutions;
  }

  // ---------- generator ----------
  function generate(difficulty, seed) {
    const cfg = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    if (seed == null) seed = Math.floor(Math.random() * 2 ** 31);
    const rng = mulberry32(seed);

    for (let attempt = 0; attempt < 400; attempt++) {
      const map = buildMap(rng, cfg);
      const tiles = openTiles(map);
      const [tr, tc] = pick(rng, tiles);
      const liarCount = pick(rng, cfg.liars);
      const liarIdx = new Set(shuffle(rng, [...Array(cfg.people).keys()]).slice(0, liarCount));
      const roles = [...Array(cfg.people).keys()].map((i) => liarIdx.has(i));
      const people = shuffle(rng, PEOPLE).slice(0, cfg.people);
      const islanders = people.map((p, i) => ({ ...p, liar: roles[i], statements: [] }));

      const locAll = locationStatements(map).filter((st) => {
        // Skip statements that are true everywhere or nowhere: they say nothing.
        let t = 0;
        for (const [r, c] of tiles) if (evalStmt(map, st, 0, r, c, roles)) t++;
        return t > 0 && t < tiles.length;
      });
      const used = new Set();

      // Candidate statements islander i could say: honest ones must be true, liars' false.
      function candidates(i, wantPerson) {
        const pool = wantPerson ? personStatements(i, cfg.people) : locAll;
        return pool.filter((st) => {
          if (used.has(stmtKey(st))) return false;
          if (islanders[i].statements.some((s) => isPersonStmt(s)) && isPersonStmt(st)) return false;
          return evalStmt(map, st, i, tr, tc, roles) !== roles[i];
        });
      }
      function say(i, st) { islanders[i].statements.push(st); used.add(stmtKey(st)); }

      // Everyone says one thing to start.
      let personCount = 0;
      for (let i = 0; i < cfg.people; i++) {
        const wantPerson = rng() < cfg.personBias;
        let cands = candidates(i, wantPerson);
        if (!cands.length) cands = candidates(i, !wantPerson);
        const st = pick(rng, cands);
        if (isPersonStmt(st)) personCount++;
        say(i, st);
      }
      // A good puzzle needs at least one statement about another islander.
      if (personCount === 0) {
        const i = Math.floor(rng() * cfg.people);
        islanders[i].statements = [];
        say(i, pick(rng, candidates(i, true)));
      }

      // Add statements until exactly one answer remains, keeping only ones that narrow it down.
      let sols = solve(map, islanders, liarCount, tiles);
      let stuck = false;
      while (sols.length > 1 && !stuck) {
        stuck = true;
        const order = shuffle(rng, [...Array(cfg.people).keys()]).filter(
          (i) => islanders[i].statements.length < cfg.maxPer
        );
        let best = null;
        for (const i of order) {
          for (const st of shuffle(rng, candidates(i, false).concat(candidates(i, true))).slice(0, 25)) {
            islanders[i].statements.push(st);
            const s2 = solve(map, islanders, liarCount, tiles);
            islanders[i].statements.pop();
            // Prefer statements that narrow things down without solving it in one stroke.
            const score = s2.length === 1 ? 1.5 : s2.length;
            if (s2.length < sols.length && (!best || score < best.score)) best = { i, st, score, s2 };
          }
          if (best) break;
        }
        if (best) {
          say(best.i, best.st);
          sols = best.s2;
          stuck = false;
        }
      }
      if (sols.length !== 1) continue;

      // Put person statements last in each speech bubble; it reads more naturally.
      islanders.forEach((p) => p.statements.sort((a, b) => isPersonStmt(a) - isPersonStmt(b)));

      return {
        seed,
        difficulty,
        map,
        liarCount,
        treasure: { r: tr, c: tc },
        islanders: islanders.map((p) => ({
          name: p.name,
          icon: p.icon,
          liar: p.liar,
          statements: p.statements,
          lines: p.statements.map((st) => stmtText(map, people, st)),
        })),
      };
    }
    throw new Error('Could not generate a puzzle');
  }

  const api = { generate, solve, openTiles, TERRAINS, DIFFICULTY, mulberry32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LiarsMap = api;
})(typeof window !== 'undefined' ? window : globalThis);
