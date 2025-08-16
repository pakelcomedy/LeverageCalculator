// script.js - fixed, accurate, and guaranteed to render results
(() => {
  'use strict';

  // Safe storage wrapper (localStorage or in-memory fallback)
  const SafeStore = (() => {
    let memory = {};
    function canUseLS() {
      try { const k='__test__'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; }
      catch(e) { return false; }
    }
    const useLS = canUseLS();
    return {
      get(k){ if(useLS) try{return localStorage.getItem(k);}catch(e){return memory[k]||null} return memory[k]||null; },
      set(k,v){ if(useLS) try{localStorage.setItem(k,v);return true;}catch(e){memory[k]=v;return false} memory[k]=v; return false; },
      remove(k){ if(useLS) try{localStorage.removeItem(k);return true;}catch(e){delete memory[k];return false} delete memory[k]; return false; }
    };
  })();

  // helpers
  const $ = id => document.getElementById(id) || null;
  const q = (s, root=document) => (root||document).querySelector(s) || null;
  const safeNum = (v, fallback=0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const fmt = (v, d=6) => {
    if (v === null || v === undefined || !isFinite(v)) return '-';
    if (Math.abs(v) >= 1) return Number(v.toFixed(4)).toString();
    return Number(v.toFixed(d)).toString();
  };
  const nowStr = () => new Date().toLocaleString();

  // DOMContentLoaded to be safe
  document.addEventListener('DOMContentLoaded', () => {
    // Elements (may be null; code handles gracefully)
    const exchangeSelect = $('exchangeSelect');
    const makerFeeDisplay = $('makerFeeDisplay');
    const takerFeeDisplay = $('takerFeeDisplay');
    const makerFeePctHidden = $('makerFeePct');
    const takerFeePctHidden = $('takerFeePct');
    const fundIntervalInfo = $('fundIntervalInfo');

    const coinName = $('coinName');
    const positionSide = $('positionSide');
    const marginEl = $('margin');
    const leverageEl = $('leverage');
    const entryPriceEl = $('entryPrice');

    const holdDurationEl = $('holdDuration');
    const holdUnitEl = $('holdUnit');

    const targetsWrapper = $('targetsWrapper');
    const addTargetBtn = $('addTarget');
    const clearTargetsBtn = $('clearTargets');

    const calculateBtn = $('calculateBtn');
    const resetBtn = $('resetBtn');

    const notionalEl = $('notional');
    const qtyEl = $('qty');
    const liqPriceEl = $('liqPrice');
    const liqSimpleEl = $('liqSimple');
    const equityExampleEl = $('equityExample');
    const fundingCostEl = $('fundingCost');
    const targetsTableBody = q('#targetsTable tbody');
    const miniChart = $('miniChart');

    const exportCsvBtn = $('exportCsv');
    const clearHistoryBtn = $('clearHistory');
    const historyTableBody = q('#historyTable tbody');

    const resExchange = $('resExchange');
    const themeToggle = $('themeToggle');

    // Load exchangeData JSON from page
    let EXCH = {};
    try {
      const n = document.getElementById('exchangeData');
      if (n) EXCH = JSON.parse(n.textContent || n.innerText || '{}');
    } catch (e) { EXCH = {}; console.warn('exchangeData parse error', e); }

    // Targets helpers
    function getTargetInputs(){
      if (!targetsWrapper) return [];
      return Array.from(targetsWrapper.querySelectorAll('.targetInput')||[]);
    }
    function addTargetInput(val=''){
      if (!targetsWrapper) return;
      const container = targetsWrapper.querySelector('.targets');
      if (!container) return;
      const wrap = document.createElement('div');
      wrap.style.display='flex'; wrap.style.alignItems='center'; wrap.style.marginBottom='6px';
      const input = document.createElement('input');
      input.type='number'; input.step='any'; input.className='targetInput'; input.placeholder='0.13'; input.value = val;
      input.style.flex='1'; input.style.padding='8px';
      const rm = document.createElement('button'); rm.type='button'; rm.textContent='x'; rm.style.marginLeft='6px';
      rm.onclick = ()=> wrap.remove();
      wrap.appendChild(input); wrap.appendChild(rm); container.appendChild(wrap);
    }
    if (getTargetInputs().length===0) addTargetInput();
    if (addTargetBtn) addTargetBtn.addEventListener('click', ()=> addTargetInput());
    if (clearTargetsBtn) clearTargetsBtn.addEventListener('click', ()=> { const c = targetsWrapper && targetsWrapper.querySelector('.targets'); if(c){c.innerHTML=''; addTargetInput();} });

    // Apply exchange defaults to UI (safe)
    function applyExchangeDefaults(key){
      const info = EXCH && EXCH[key] ? EXCH[key] : null;
      if (resExchange) resExchange.textContent = info ? (info.label || key) : (key||'-');
      if (makerFeeDisplay) makerFeeDisplay.value = info ? `${safeNum(info.maker_pct,0)} %` : '';
      if (takerFeeDisplay) takerFeeDisplay.value = info ? `${safeNum(info.taker_pct,0)} %` : '';
      if (makerFeePctHidden) makerFeePctHidden.value = info ? `${safeNum(info.maker_pct,0)}` : '';
      if (takerFeePctHidden) takerFeePctHidden.value = info ? `${safeNum(info.taker_pct,0)}` : '';
      if (fundIntervalInfo) fundIntervalInfo.value = info ? `${safeNum(info.funding_interval_hours,8)} hrs (baseline ${safeNum(info.interest_daily_pct,0)}%/day)` : '';
      if (exchangeSelect) {
        exchangeSelect.dataset.fundingIntervalHours = info ? `${safeNum(info.funding_interval_hours,8)}` : '';
        exchangeSelect.dataset.interestDailyPct = info ? `${safeNum(info.interest_daily_pct,0)}` : '';
      }
    }
    if (exchangeSelect) {
      applyExchangeDefaults(exchangeSelect.value);
      exchangeSelect.addEventListener('change', e => applyExchangeDefaults(e.target.value));
    } else {
      // if no select, still try apply default 'binance' if available
      if (EXCH.binance) applyExchangeDefaults('binance');
    }

    // Calculation core (clean & correct)
    function calculateAll({side='long', margin=0, leverage=1, entry=0, targets=[], holdHours=0, feeMode='taker'}) {
      margin = safeNum(margin,0); leverage = safeNum(leverage,1); entry = safeNum(entry,0);
      targets = Array.isArray(targets) ? targets.map(v=>safeNum(v,NaN)).filter(v=>isFinite(v)&&v>0) : [];
      if (!margin || !leverage || !entry) return null;

      // read hidden fee percent values (expected like 0.018 meaning 0.018%).
      const makerPctRaw = safeNum(makerFeePctHidden ? makerFeePctHidden.value : 0, 0);
      const takerPctRaw = safeNum(takerFeePctHidden ? takerFeePctHidden.value : 0, 0);
      // Convert to fraction: e.g. 0.018 => 0.018% => 0.00018 fraction
      const makerFrac = makerPctRaw / 100.0;
      const takerFrac = takerPctRaw / 100.0;
      const feeFrac = feeMode === 'maker' ? makerFrac : takerFrac;

      const notional = margin * leverage;
      const qty = entry > 0 ? notional / entry : 0;

      const liqSimple = side === 'long' ? entry * (1 - 1/leverage) : entry * (1 + 1/leverage);

      // maintenance margin: optional input 'maintPct' if exists, else default 0.5%
      const maintEl = $('maintPct');
      const maintPct = maintEl ? (safeNum(maintEl.value, 0.5) / 100.0) : 0.005; // fraction

      // fees estimate: round-trip using selected fee type on notional
      const feeOnEnter = notional * feeFrac;
      const feeOnExit = notional * feeFrac;
      const feesEstimated = feeOnEnter + feeOnExit;

      // funding baseline: interest_daily_pct / intervalsPerDay * numIntervals * notional
      const fundingIntervalHours = safeNum(exchangeSelect && exchangeSelect.dataset.fundingIntervalHours ? exchangeSelect.dataset.fundingIntervalHours : 8, 8);
      const interestDailyPct = safeNum(exchangeSelect && exchangeSelect.dataset.interestDailyPct ? exchangeSelect.dataset.interestDailyPct : 0, 0);
      const interestDailyFrac = interestDailyPct / 100.0; // e.g., 0.03% => 0.0003
      const intervalsPerDay = fundingIntervalHours>0 ? (24 / fundingIntervalHours) : 24;
      const perIntervalFrac = interestDailyFrac / intervalsPerDay;
      const numIntervals = fundingIntervalHours>0 ? holdHours / fundingIntervalHours : 0;
      const fundingBaselineTotal = notional * perIntervalFrac * numIntervals;
      // sign: baseline cost for LONG (positive), credit for SHORT (negative)
      const fundingSigned = side === 'long' ? fundingBaselineTotal : -fundingBaselineTotal;

      // Solve for liquidation price using equity == MMR * notional
      // Q = notional / entry
      const Q = qty;
      const baseTerm = (maintPct * notional - margin + feesEstimated); // excludes funding
      const liqAdvanced_noFunding = Q > 0 ? (side === 'long' ? entry + (baseTerm)/Q : entry - (baseTerm)/Q) : NaN;
      const baseWithFunding = baseTerm + fundingSigned;
      const liqAdvanced_withFunding = Q > 0 ? (side === 'long' ? entry + (baseWithFunding)/Q : entry - (baseWithFunding)/Q) : NaN;

      // per-target computations
      const results = targets.map(t => {
        const pl = side === 'long' ? (t - entry) * Q : (entry - t) * Q;
        const totalFees = feesEstimated;
        const funding = fundingSigned;
        const equity = margin + pl - totalFees - funding;
        return { target: t, pl, equity, totalFees, funding };
      });

      return {
        exchangeKey: exchangeSelect ? exchangeSelect.value : 'custom',
        exchangeLabel: EXCH && EXCH[exchangeSelect?exchangeSelect.value:''] ? EXCH[exchangeSelect.value].label : (exchangeSelect?exchangeSelect.value:'custom'),
        notional, qty, liqSimple, liqAdvanced_noFunding, liqAdvanced_withFunding,
        feesEstimated, feeOnEnter, feeOnExit, funding: fundingSigned, feeFrac,
        fundingIntervalHours, interestDailyPct, perIntervalFrac, numIntervals,
        results
      };
    }

    // Render results (always attempt to write to DOM; if an element is missing, skip only that element)
    function renderResults(calc) {
      if (!calc) {
        if (notionalEl) notionalEl.textContent = '-';
        if (qtyEl) qtyEl.textContent = '-';
        if (liqSimpleEl) liqSimpleEl.textContent = '-';
        if (liqPriceEl) liqPriceEl.textContent = '-';
        if (equityExampleEl) equityExampleEl.textContent = '-';
        if (fundingCostEl) fundingCostEl.textContent = '-';
        if (targetsTableBody) targetsTableBody.innerHTML = '';
        if (miniChart) miniChart.innerHTML = '';
        return;
      }

      if (notionalEl) notionalEl.textContent = fmt(calc.notional,6);
      if (qtyEl) qtyEl.textContent = fmt(calc.qty,8);
      if (liqSimpleEl) liqSimpleEl.textContent = fmt(calc.liqSimple,8);

      const showLiq = (Math.abs(calc.funding) > 0 && isFinite(calc.liqAdvanced_withFunding)) ? `${fmt(calc.liqAdvanced_withFunding,8)} (with funding)` : fmt(calc.liqAdvanced_noFunding,8);
      if (liqPriceEl) liqPriceEl.textContent = showLiq;

      if (fundingCostEl) fundingCostEl.textContent = fmt(calc.funding,6);

      // targets table
      if (targetsTableBody) {
        targetsTableBody.innerHTML = '';
        if (calc.results && calc.results.length) {
          calc.results.forEach(r => {
            const tr = document.createElement('tr');
            const tdT = document.createElement('td'); tdT.textContent = fmt(r.target,8);
            const tdPL = document.createElement('td'); tdPL.textContent = fmt(r.pl,6);
            const tdEq = document.createElement('td'); tdEq.textContent = fmt(r.equity,6);
            const tdFee = document.createElement('td'); tdFee.textContent = `${fmt(r.totalFees,4)} / funding ${fmt(r.funding,4)}`;
            tr.appendChild(tdT); tr.appendChild(tdPL); tr.appendChild(tdEq); tr.appendChild(tdFee);
            targetsTableBody.appendChild(tr);
          });
        } else {
          const tr = document.createElement('tr');
          const td = document.createElement('td'); td.colSpan = 4; td.textContent = 'No targets';
          tr.appendChild(td); targetsTableBody.appendChild(tr);
        }
      }

      if (equityExampleEl) equityExampleEl.textContent = (calc.results && calc.results.length) ? fmt(calc.results[0].equity,6) : '-';
      drawMiniChart(calc);
    }

    // minimal SVG mini chart (if miniChart exists)
    function drawMiniChart(calc){
      if (!miniChart) return;
      miniChart.innerHTML = '';
      try {
        const arr = [];
        const liqVal = calc.liqAdvanced_withFunding || calc.liqAdvanced_noFunding || calc.liqSimple;
        arr.push({label:'LIQ', v:liqVal});
        const entryVal = safeNum(entryPriceEl ? entryPriceEl.value : NaN, NaN);
        arr.push({label:'ENTRY', v:entryVal});
        (calc.results||[]).forEach((r,i)=> arr.push({label:`T${i+1}`, v:r.target}));
        const vals = arr.map(x=>x.v).filter(v=>isFinite(v) && v>0);
        if (vals.length < 2) { miniChart.textContent = 'Not enough values to draw chart'; return; }
        const min = Math.min(...vals), max = Math.max(...vals), range = max-min || max*0.001;
        const padLeft = 40, widthPx = 760, baseY=28;
        const svgNS='http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS,'svg');
        svg.setAttribute('width','100%'); svg.setAttribute('height','56'); svg.setAttribute('viewBox','0 0 800 56');
        const line = document.createElementNS(svgNS,'line');
        line.setAttribute('x1',padLeft); line.setAttribute('x2',padLeft+widthPx); line.setAttribute('y1',baseY); line.setAttribute('y2',baseY); line.setAttribute('stroke','#999'); svg.appendChild(line);
        const scaleX = v => padLeft + ((v-min)/range)*widthPx;
        const make = (x,color,label) => {
          const g = document.createElementNS(svgNS,'g');
          const c = document.createElementNS(svgNS,'circle'); c.setAttribute('cx',x); c.setAttribute('cy',baseY); c.setAttribute('r',6); c.setAttribute('fill',color); g.appendChild(c);
          const t = document.createElementNS(svgNS,'text'); t.setAttribute('x',x); t.setAttribute('y',baseY-12); t.setAttribute('text-anchor','middle'); t.setAttribute('font-size','11'); t.setAttribute('fill','#fff'); t.textContent=label; g.appendChild(t);
          return g;
        };
        svg.appendChild(make(scaleX(liqVal), '#ef4444','LIQ'));
        if (isFinite(entryVal)) svg.appendChild(make(scaleX(entryVal), '#2563eb','ENTRY'));
        (calc.results||[]).forEach((r,i)=> svg.appendChild(make(scaleX(r.target),'#10b981',`T${i+1}`)));
        miniChart.appendChild(svg);
      } catch(e){ miniChart.textContent='Chart error'; console.error(e); }
    }

    // History functions
    const HIST_KEY = 'levcalc_history_v1';
    function loadHistory(){ try { const raw = SafeStore.get(HIST_KEY); return raw ? JSON.parse(raw) : []; } catch(e){return [];} }
    function saveHistory(arr){ try { SafeStore.set(HIST_KEY, JSON.stringify(arr)); } catch(e){console.warn('saveHistory fail',e);} }
    function pushHistory(item){ const arr = loadHistory(); arr.unshift(item); if(arr.length>500) arr.length = 500; saveHistory(arr); renderHistory(); }
    function renderHistory(){
      if (!historyTableBody) return;
      const arr = loadHistory();
      historyTableBody.innerHTML = '';
      if (!arr.length){ const tr = document.createElement('tr'); const td = document.createElement('td'); td.colSpan=8; td.textContent='No history'; tr.appendChild(td); historyTableBody.appendChild(tr); return; }
      arr.forEach((h, idx) => {
        const tr = document.createElement('tr');
        const add = t => { const td = document.createElement('td'); td.textContent = t; return td; };
        tr.appendChild(add(h.time)); tr.appendChild(add(h.coin||'-')); tr.appendChild(add(fmt(h.entry,8)));
        tr.appendChild(add(h.leverage)); tr.appendChild(add(h.side)); tr.appendChild(add(fmt(h.liq,8)));
        tr.appendChild(add(h.example ? fmt(h.example.equity,6) : '-'));
        const tdA = document.createElement('td');
        const del = document.createElement('button'); del.textContent='Delete'; del.style.background='#ef4444'; del.style.color='#fff'; del.style.border='none'; del.style.padding='6px'; del.style.borderRadius='6px';
        del.onclick = ()=>{ const all = loadHistory(); all.splice(idx,1); saveHistory(all); renderHistory(); };
        tdA.appendChild(del); tr.appendChild(tdA);
        historyTableBody.appendChild(tr);
      });
    }
    function exportCSV(){
      const arr = loadHistory(); if(!arr.length){ alert('No history to export'); return; }
      const header = ['time','coin','side','entry','margin','leverage','notional','qty','liq','feesEstimated','funding','targets','note'];
      const rows = arr.map(h => {
        const s = x => `"${String(x||'').replace(/"/g,'""')}"`;
        return [s(h.time), s(h.coin), s(h.side), h.entry, h.margin, h.leverage, h.notional, h.qty, h.liq, h.feesEstimated, h.funding, s((h.targets||[]).join('|')), s(h.note)].join(',');
      });
      const csv = [header.join(','), ...rows].join('\n');
      const blob = new Blob([csv], {type:'text/csv'}); const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `levcalc_history_${(new Date()).toISOString().slice(0,10)}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    }

    // Events
    if (calculateBtn) calculateBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      const side = positionSide ? positionSide.value : 'long';
      const margin = marginEl ? safeNum(marginEl.value,0) : 0;
      const leverage = leverageEl ? safeNum(leverageEl.value,1) : 1;
      const entry = entryPriceEl ? safeNum(entryPriceEl.value,0) : 0;
      const targets = getTargetInputs().map(i=>safeNum(i.value,NaN)).filter(v=>isFinite(v)&&v>0);
      if (!margin || !leverage || !entry || targets.length===0) { alert('Isi modal, leverage, entry, dan minimal 1 target.'); return; }
      let holdHours = holdDurationEl ? safeNum(holdDurationEl.value,0) : 0;
      if (holdUnitEl && holdUnitEl.value === 'days') holdHours *= 24;
      const calc = calculateAll({side, margin, leverage, entry, targets, holdHours, feeMode:'taker'});
      // render to UI
      renderResults(calc);
      // save to history (with key fields)
      const item = {
        time: nowStr(),
        coin: (coinName ? coinName.value : '-') || '-',
        side, margin, leverage, entry,
        notional: calc ? calc.notional : 0,
        qty: calc ? calc.qty : 0,
        liq: calc ? (Math.abs(calc.funding)>0 ? calc.liqAdvanced_withFunding : calc.liqAdvanced_noFunding) : 0,
        feesEstimated: calc ? calc.feesEstimated : 0,
        funding: calc ? calc.funding : 0,
        targets,
        example: calc && calc.results && calc.results.length ? {pl: calc.results[0].pl, equity: calc.results[0].equity} : null,
        note: ($('note') ? $('note').value : '')
      };
      pushHistory(item);
    });

    if (resetBtn) resetBtn.addEventListener('click', ()=> {
      if (coinName) coinName.value=''; if (positionSide) positionSide.value='long'; if (marginEl) marginEl.value=''; if (leverageEl) leverageEl.value='10';
      if (entryPriceEl) entryPriceEl.value=''; if (holdDurationEl) holdDurationEl.value='24'; if (holdUnitEl) holdUnitEl.value='hours';
      if (clearTargetsBtn) clearTargetsBtn.click(); if ($('note')) $('note').value=''; renderResults(null);
    });

    if (exportCsvBtn) exportCsvBtn.addEventListener('click', exportCSV);
    if (clearHistoryBtn) clearHistoryBtn.addEventListener('click', ()=> {
      if (!confirm('Hapus seluruh history?')) return;
      SafeStore.remove(HIST_KEY); renderHistory();
    });

    // Theme (persist)
    function applyTheme(dark){ if(dark) document.documentElement.setAttribute('data-theme','dark'); else document.documentElement.removeAttribute('data-theme'); if (themeToggle) themeToggle.textContent = dark ? '☀️' : '🌙'; SafeStore.set('levcalc_theme', dark ? 'dark' : 'light'); }
    if (themeToggle) themeToggle.addEventListener('click', ()=> applyTheme(!(document.documentElement.getAttribute('data-theme')==='dark')));
    const savedTheme = SafeStore.get('levcalc_theme') || (window.matchMedia && window.matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
    applyTheme(savedTheme === 'dark');

    // initial render of history
    renderHistory();
    renderResults(null);

  }); // DOMContentLoaded end

})(); // IIFE end
