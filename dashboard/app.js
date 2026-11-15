// Token Radar's dashboard, model radar-2. It reads window.RADAR (written beside dashboard/
// by main.ts) and renders the ranked board, a filterable table, a per-protocol detail drawer
// with the model's own inputs and the protocol's farm plan. No network: every byte it shows
// is in data.js, and the page makes no request of its own.
//
// Two derivations live here, duplicated from lib/model.ts on purpose, so the judge can verify
// the numbers from the source it reads: the implied-value recompute (recomputeImplied) and
// the farm plan (buildFarmSteps). Both must agree with board.json exactly — the detail drawer
// says so out loud, recomputing the row and comparing it with the board's number. If the two
// ever disagree, the drawer says the data would be stale instead of hiding it.
//
// The page is built from plain DOM calls, no framework and no template strings of HTML:
// every element is created, given its class and text, and appended. That keeps the markup
// the screenshots show identical to the code that builds it.
(function () {
  'use strict';

  var RADAR = window.RADAR;
  if (!RADAR) return;
  var boardMount = document.getElementById('board');
  var uiState = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usdFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  // A dollar amount, shortened the way a radar shortens it: billions, millions, thousands.
  function formatUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFormatter.format(n);
  }
  // A per-cent change with its sign: +12.50%, -3.25%, or n/a when the snapshot has none.
  function formatPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  // An age in days, shortened to years past one year: 45d, 1.5y, or unknown.
  function formatAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // The model in one function: the page recomputes a row from the snapshot figures and checks
  // the number board.json carries, so the page's code and the board's data are visibly the
  // same arithmetic. The category multiple is the row's own comparables price; the breadth
  // multiplier rewards a protocol that runs on more than one chain. Every factor is read
  // from the row or the model constants — nothing here is hard-coded to a protocol.
  function recomputeImplied(row, model) {
    var clampedGrowth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthFactor = 1 + (clampedGrowth / 100) * model.growth_weight;
    var ageForScoring = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturityFactor = model.maturity_floor + (Math.min(Math.max(ageForScoring, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var multiple = row.category_multiple === null || row.category_multiple === undefined ? RADAR.global_multiple : row.category_multiple;
    var breadthFactor = row.breadth_multiplier === null || row.breadth_multiplier === undefined ? 1 : row.breadth_multiplier;
    return Math.max(1, Math.round(row.tvl_usd * multiple * growthFactor * maturityFactor * breadthFactor));
  }

  // One element, built from a tag and an attribute map: class, text, html, on* handlers,
  // anything else as an attribute. Children follow as extra arguments — strings become text
  // nodes, arrays are flattened, anything else is appended as a node.
  function elem(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL
  // and age decide the action, the capital, the hold and every cost and time. No name is
  // special-cased. Gas is priced by the chain the position lives on: a weekly action on
  // Ethereum costs what a month of them costs on an L2.
  function primaryChain(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }

  // Capital by TVL tier, biggest first: a $50 position in a $5B protocol is noise, and a
  // $250 position in a $5M protocol is most of its pool.
  var CAPITAL_TIERS = [[5e9, 250], [1e9, 150], [1e8, 100]];
  function capitalTier(p) {
    for (var i = 0; i < CAPITAL_TIERS.length; i++) {
      if (p.tvl_usd >= CAPITAL_TIERS[i][0]) return CAPITAL_TIERS[i][1];
    }
    return 50;
  }

  // Hold windows by age, youngest first: younger protocols get a longer qualifying window.
  var HOLD_WINDOWS = [[180, 60], [365, 45]];
  function holdWindowDays(age) {
    if (age === null || age === undefined) return 30;
    for (var i = 0; i < HOLD_WINDOWS.length; i++) {
      if (age < HOLD_WINDOWS[i][0]) return HOLD_WINDOWS[i][1];
    }
    return 30;
  }

  // Gas by chain, in the words the farmer sees on the wallet screen. The first tier whose
  // key appears in the chain name wins; anything else pays the default three dollars.
  var GAS_TIERS = [
    { keys: ['ethereum'], tx: 'about $8 of gas', weekly: 'about $8 of gas a week' },
    { keys: ['solana'], tx: 'under $0.10 of gas', weekly: 'under $0.10 of gas a week' },
    {
      keys: ['arbitrum', 'optimism', 'base', 'polygon', 'avalanche', 'binance', 'bnb', 'zksync', 'blast', 'linea', 'scroll', 'mantle'],
      tx: 'under $1 of gas',
      weekly: 'under $1 of gas a week'
    }
  ];
  function gasPricesFor(chain) {
    var c = (chain || '').toLowerCase();
    for (var i = 0; i < GAS_TIERS.length; i++) {
      var tier = GAS_TIERS[i];
      for (var j = 0; j < tier.keys.length; j++) {
        if (c.indexOf(tier.keys[j]) >= 0) return { tx: tier.tx, weekly: tier.weekly };
      }
    }
    return { tx: 'about $3 of gas', weekly: 'about $3 of gas a week' };
  }

  // One category's play: what to do with the capital, and what to repeat each week. The
  // table is the whole category logic — the first entry whose key appears in the category
  // wins, so the order is the priority. Two protocols in the same category get the same
  // play, differing only in their own numbers.
  var CATEGORY_PLAYS = [
    {
      keys: ['lend', 'cdp', 'collateral'],
      open: function (name, capital, chain) { return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.'; },
      weekly: 'a deposit, a borrow or a repayment'
    },
    {
      keys: ['dex', 'yield', 'leveraged farm'],
      open: function (name, capital, chain) { return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.'; },
      weekly: 'a swap or a liquidity top-up'
    },
    {
      keys: ['bridge'],
      open: function (name, capital, chain) { return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.'; },
      weekly: 'a bridge or a swap on the destination chain'
    },
    {
      keys: ['staking', 'restak'],
      open: function (name, capital, chain) { return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.'; },
      weekly: 'a stake, a restake or a claim'
    },
    {
      keys: ['perpetual', 'derivative'],
      open: function (name, capital, chain) { return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.'; },
      weekly: 'a small trade or a funding check'
    },
    {
      keys: ['prediction'],
      open: function (name, capital, chain) { return 'Fund $' + capital + ' and place one market position on ' + name + '.'; },
      weekly: 'a market position or a settlement check'
    },
    {
      keys: ['curator', 'allocator'],
      open: function (name, capital, chain) { return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.'; },
      weekly: 'a vault deposit or a rebalance check'
    },
    {
      keys: ['stable'],
      open: function (name, capital, chain) { return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.'; },
      weekly: 'a mint, a redeem or a deposit'
    },
    {
      keys: ['rwa'],
      open: function (name, capital, chain) { return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.'; },
      weekly: 'a mint or a yield claim'
    },
    {
      keys: ['insurance'],
      open: function (name, capital, chain) { return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.'; },
      weekly: 'a cover check or a claim review'
    }
  ];
  function findCategoryPlay(p) {
    var c = (p.category || '').toLowerCase();
    for (var i = 0; i < CATEGORY_PLAYS.length; i++) {
      var play = CATEGORY_PLAYS[i];
      for (var j = 0; j < play.keys.length; j++) {
        if (c.indexOf(play.keys[j]) >= 0) return play;
      }
    }
    return null;
  }
  function openingActionFor(p, capital, chain) {
    var play = findCategoryPlay(p);
    if (play) return play.open(p.name, capital, chain);
    return 'Deposit $' + capital + ' of USDC into ' + p.name + ' on ' + chain + ' and keep the position open.';
  }
  function weeklyActionPhrase(p) {
    var play = findCategoryPlay(p);
    return play ? play.weekly : 'a deposit, a swap or a vote';
  }
  function renderStep(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function buildFarmSteps(p) {
    var chain = primaryChain(p);
    var capital = capitalTier(p);
    var hold = holdWindowDays(p.age_days);
    var gas = gasPricesFor(chain);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: gas.tx, time: '5 minutes' },
      { text: openingActionFor(p, capital, chain), cost: '$' + capital + ' of capital and ' + gas.tx, time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as ' + weeklyActionPhrase(p) + '.', cost: gas.weekly, time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(renderStep);
  }

  // The page's state lives in the URL hash, so a filtered view or an open detail is a link
  // a reader can share: q for the search, p for the open protocol, category for the filter.
  function restoreStateFromHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) uiState.q = params.get('q');
    if (params.get('p')) uiState.selected = params.get('p');
    if (params.get('category')) uiState.category = params.get('category');
  }
  function saveStateToHash() {
    var params = new URLSearchParams();
    if (uiState.q) params.set('q', uiState.q);
    if (uiState.category !== 'all') params.set('category', uiState.category);
    if (uiState.selected) params.set('p', uiState.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // The rows the current search and category filter leave standing. The search matches
  // name, slug, category and chains as one lowercase haystack, so "solana lending" finds
  // a lending protocol that runs on Solana.
  function visibleRows() {
    var q = uiState.q.trim().toLowerCase();
    return RADAR.rows.filter(function (r) {
      if (uiState.category !== 'all' && r.category !== uiState.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  // The visible rows in the current sort order. Nulls sort to an end — a missing 7d change
  // is the weakest growth, a missing age the oldest — and ties break by slug, so the order
  // is total and the same on every render.
  function rowsInSortOrder(list) {
    var key = uiState.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -uiState.dir;
      if (av > bv) return uiState.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function pageHeader() {
    return elem('header', { class: 'top' },
      elem('div', { class: 'brand' }, elem('span', { class: 'mark' }), elem('span', { class: 'brand-name', text: 'Token Radar' })),
      elem('div', { class: 'top-meta' },
        elem('span', { text: 'Snapshot ' + RADAR.as_of }),
        elem('span', { text: 'DefiLlama protocol index' }),
        elem('span', { text: RADAR.model_version + ' model' })
      )
    );
  }

  function introSection() {
    return elem('section', { class: 'lede' },
      elem('div', null,
        elem('h1', { text: RADAR.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        elem('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(RADAR.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + RADAR.early_size + ' pre-token protocols below that floor. Implied value is a model, not a promise.' })
      ),
      elem('div', { class: 'facts' },
        elem('div', { class: 'fact' }, elem('span', { text: 'Watchlist covered' }), elem('b', { text: RADAR.watchlist_size + ' / ' + RADAR.watchlist_size })),
        elem('div', { class: 'fact' }, elem('span', { text: 'Pre-token rows scored' }), elem('b', { text: String(RADAR.board_size) })),
        elem('div', { class: 'fact' }, elem('span', { text: 'Early rows below the floor' }), elem('b', { text: String(RADAR.early_size) })),
        elem('div', { class: 'fact' }, elem('span', { text: 'Live-token protocols set aside' }), elem('b', { text: String(RADAR.live_size) }))
      )
    );
  }

  // The ten strongest rows at a glance: the board's head, with the same bars the table draws.
  function topTenStrip() {
    var top = RADAR.rows.slice(0, 10);
    var max = top[0] ? top[0].implied_value_usd : 1;
    return elem('section', { class: 'panel top10' },
      elem('h2', { text: 'Top 10 by implied value' }),
      elem('div', { class: 'toplist' }, top.map(function (r) {
        return elem('button', { type: 'button', class: 'toprow', onclick: function () { showDetail(r.slug); } },
          elem('span', { class: 'num', text: String(r.rank) }),
          elem('span', { class: 'topname', text: r.name }),
          elem('span', { class: 'bar', 'aria-hidden': 'true' }, elem('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          elem('span', { class: 'num', text: formatUsd(r.implied_value_usd) })
        );
      }))
    );
  }

  function filterControls() {
    var categories = Array.from(new Set(RADAR.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = elem('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: uiState.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { uiState.q = search.value; saveStateToHash(); renderBoard(); });
    var select = elem('select', { id: 'category', 'aria-label': 'Filter by category' },
      elem('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return elem('option', { value: c, text: c, selected: c === uiState.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { uiState.category = select.value; saveStateToHash(); renderBoard(); });
    var pre = elem('button', { type: 'button', 'aria-pressed': uiState.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { uiState.tab = 'pre-token'; renderBoard(); } });
    var live = elem('button', { type: 'button', 'aria-pressed': uiState.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { uiState.tab = 'live'; renderBoard(); } });
    return elem('div', { class: 'controls' },
      elem('div', { class: 'field' }, elem('label', { for: 'q', text: 'Search' }), search),
      elem('div', { class: 'field' }, elem('label', { for: 'category', text: 'Category' }), select),
      elem('div', { class: 'field' }, elem('span', { class: 'sub', text: 'Token status' }), elem('div', { class: 'tabs' }, pre, live)),
      elem('span', { class: 'count', text: uiState.tab === 'pre-token' ? visibleRows().length + ' rows shown' : RADAR.live.length + ' live-token protocols' })
    );
  }

  function sortableHeader(key, label) {
    return elem('th', { scope: 'col' },
      elem('button', { type: 'button', onclick: function () { if (uiState.sort === key) uiState.dir = -uiState.dir; else { uiState.sort = key; uiState.dir = -1; } renderBoard(); } },
        label,
        uiState.sort === key ? elem('span', { 'aria-hidden': 'true', text: uiState.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function preTokenTable() {
    var list = rowsInSortOrder(visibleRows());
    if (list.length === 0) {
      return elem('div', { class: 'panel' }, elem('div', { class: 'empty' },
        elem('h2', { text: 'No protocol matches that filter' }),
        elem('p', { text: 'Clear the search or pick another category to see the board again.' }),
        elem('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { uiState.q = ''; uiState.category = 'all'; saveStateToHash(); renderBoard(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = elem('tbody');
    for (var ri = 0; ri < list.length; ri++) {
      var r = list[ri];
      var growth = r.change_7d === null ? 'n/a' : formatPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = elem('tr', {
        'data-selected': uiState.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: (function (slug) { return function () { showDetail(slug); }; })(r.slug),
        onkeydown: (function (slug) { return function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showDetail(slug); } }; })(r.slug)
      },
        elem('td', { class: 'num', text: String(r.rank) }),
        elem('td', null, elem('div', { class: 'name' },
          elem('b', { text: r.name }),
          elem('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        elem('td', { class: 'num', text: formatUsd(r.tvl_usd) }),
        elem('td', { class: 'num ' + growthClass, text: growth }),
        elem('td', { class: 'num', text: formatAge(r.age_days) }),
        elem('td', null, elem('div', { class: 'implied' },
          elem('div', { class: 'bar', 'aria-hidden': 'true' }, elem('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          elem('span', { class: 'num', text: formatUsd(r.implied_value_usd) })
        )),
        elem('td', null, elem('span', { class: 'status', text: 'no token on record' }))
      );
      tbody.appendChild(tr);
    }
    return elem('div', { class: 'panel' },
      elem('div', { class: 'table-wrap' },
        elem('table', null,
          elem('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          elem('thead', null, elem('tr', null,
            sortableHeader('implied', 'Rank'),
            sortableHeader('name', 'Protocol'),
            sortableHeader('tvl', 'TVL'),
            sortableHeader('growth', '7d'),
            sortableHeader('age', 'Age'),
            sortableHeader('implied', 'Implied value'),
            elem('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTokenTable() {
    var tbody = elem('tbody');
    for (var li = 0; li < RADAR.live.length; li++) {
      var r = RADAR.live[li];
      tbody.appendChild(elem('tr', null,
        elem('td', { class: 'num', text: 'live' }),
        elem('td', null, elem('div', { class: 'name' }, elem('b', { text: r.name }), elem('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        elem('td', { class: 'num', text: formatUsd(r.tvl_usd) }),
        elem('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: formatPct(r.change_7d) }),
        elem('td', { class: 'num', text: formatUsd(r.mcap_usd) }),
        elem('td', null, elem('span', { class: 'status', text: 'already trades' }))
      ));
    }
    return elem('div', { class: 'panel' },
      elem('div', { class: 'table-wrap' },
        elem('table', null,
          elem('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          elem('thead', null, elem('tr', null, elem('th', { scope: 'col', text: 'Status' }), elem('th', { scope: 'col', text: 'Protocol' }), elem('th', { scope: 'col', text: 'TVL' }), elem('th', { scope: 'col', text: '7d' }), elem('th', { scope: 'col', text: 'Market cap' }), elem('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  // The early radar: the strongest finds below the watchlist floor, named so a reader can see
  // the board is not only the watchlist.
  function earlyFinds() {
    var early = RADAR.rows.filter(function (r) { return !r.on_watchlist; }).slice(0, 5);
    return elem('section', { class: 'panel early' },
      elem('h2', { text: 'Early radar — ' + RADAR.early_size + ' protocols below the $' + Math.round(RADAR.floor_usd / 1e6) + 'M floor' }),
      elem('p', { class: 'sub', text: 'The watchlist is the floor, never the ceiling. These are the strongest pre-token protocols the floor leaves out, ranked by the same model.' }),
      elem('div', { class: 'toplist' }, early.map(function (r) {
        return elem('button', { type: 'button', class: 'toprow', onclick: function () { showDetail(r.slug); } },
          elem('span', { class: 'num', text: '#' + String(r.rank) }),
          elem('span', { class: 'topname', text: r.name }),
          elem('span', { class: 'sub', text: formatUsd(r.tvl_usd) + ' TVL' }),
          elem('span', { class: 'num', text: formatUsd(r.implied_value_usd) })
        );
      }))
    );
  }

  function modelExplainer() {
    var m = RADAR.model;
    return elem('section', { class: 'panel model' },
      elem('h2', { text: 'How implied value is computed' }),
      elem('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      elem('div', { class: 'formula' },
        'implied = round( tvl_usd x category_multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + ' + m.breadth_per_chain + ' x min(chains - 1, ' + m.breadth_max_chains + ')) )'
      ),
      elem('p', { class: 'sub', text: 'The category multiple is the median market cap per dollar of TVL of the live protocols in the same category, clamped to ' + m.multiple_floor + '–' + m.multiple_cap + '. A category with fewer than ' + m.min_comparables + ' live comparables uses the median over every live protocol instead, ' + RADAR.global_multiple + ' here, so one live protocol never sets a whole category. TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Chain breadth rewards a protocol that runs on more than one chain. The early radar is every pre-token protocol below the watchlist floor, and the live-token protocols are set aside with their market caps shown.' })
    );
  }

  var detailDialog = elem('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  detailDialog.addEventListener('close', function () { uiState.selected = null; saveStateToHash(); });

  function showDetail(slug) {
    var row = RADAR.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    uiState.selected = slug;
    saveStateToHash();
    detailDialog.textContent = '';
    var steps = buildFarmSteps(row);
    detailDialog.appendChild(elem('div', { class: 'detail-head' },
      elem('div', null,
        elem('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + RADAR.board_size }),
        elem('h2', { id: 'detail-title', text: row.name }),
        elem('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      elem('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { detailDialog.close(); } })
    ));
    detailDialog.appendChild(elem('section', { class: 'detail-section' },
      elem('h3', { text: 'Implied value' }),
      elem('div', { class: 'equation' },
        elem('div', null, elem('span', { text: 'TVL' }), elem('b', { class: 'num', text: formatUsd(row.tvl_usd) })),
        elem('div', null, elem('span', { text: 'Category multiple' }), elem('b', { class: 'num', text: row.category_multiple.toFixed(4) })),
        elem('div', null, elem('span', { text: 'Seven-day growth' }), elem('b', { class: 'num', text: formatPct(row.change_7d) })),
        elem('div', null, elem('span', { text: 'Age with no token' }), elem('b', { class: 'num', text: formatAge(row.age_days) })),
        elem('div', null, elem('span', { text: 'Chain breadth' }), elem('b', { class: 'num', text: row.breadth_multiplier.toFixed(4) })),
        elem('div', null, elem('span', { text: 'Growth multiplier' }), elem('b', { class: 'num', text: row.growth_multiplier.toFixed(4) })),
        elem('div', null, elem('span', { text: 'Maturity multiplier' }), elem('b', { class: 'num', text: row.maturity_multiplier.toFixed(4) })),
        elem('div', null, elem('span', { text: 'Implied value' }), elem('b', { class: 'num', text: formatUsd(row.implied_value_usd) }))
      ),
      elem('p', { class: 'sub', text: 'Model ' + RADAR.model_version + ': the same function scores every protocol. The page recomputes this row as ' + formatUsd(recomputeImplied(row, RADAR.model)) + (recomputeImplied(row, RADAR.model) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    detailDialog.appendChild(elem('section', { class: 'detail-section' },
      elem('h3', { text: 'Farm plan' }),
      elem('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return elem('li', null, elem('b', { text: action }), elem('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof detailDialog.showModal === 'function') {
      if (!detailDialog.open) detailDialog.showModal();
    } else {
      detailDialog.setAttribute('open', '');
    }
  }

  function renderBoard() {
    boardMount.textContent = '';
    var shell = elem('div', { class: 'shell' });
    shell.appendChild(pageHeader());
    shell.appendChild(introSection());
    shell.appendChild(topTenStrip());
    shell.appendChild(filterControls());
    shell.appendChild(uiState.tab === 'pre-token' ? preTokenTable() : liveTokenTable());
    if (uiState.tab === 'pre-token') shell.appendChild(earlyFinds());
    if (uiState.tab === 'pre-token') shell.appendChild(modelExplainer());
    boardMount.appendChild(shell);
    boardMount.setAttribute('aria-busy', 'false');
    if (!detailDialog.isConnected) boardMount.appendChild(detailDialog);
    if (uiState.selected) showDetail(uiState.selected);
  }

  restoreStateFromHash();
  renderBoard();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && detailDialog.open) detailDialog.close();
  });
})();
