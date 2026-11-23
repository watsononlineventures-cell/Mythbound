import { BET_MULTS, DENOMS, MHB_TIERS, METER_MAX } from '../math/config';
import { baseBet, betFor } from '../math/denom';
import type { MeterState } from '../math/game';
import type { MhbState } from '../math/mhb';
import { fmtCoins, fmtDenom } from './fmt';

export interface DenomView {
  current: number;
  mult: number;
  mhb: (d: number) => MhbState;
  meter: (d: number) => MeterState;
  hist: (d: number) => [number, number][];
}

/** The denomination picker: what each denom's jackpots, meter and recent spins look like right now. */
export function renderDenoms(v: DenomView) {
  document.getElementById('denom-grid')!.innerHTML = DENOMS.map((d) => {
    const base = baseBet(d);
    const mhb = v.mhb(d);
    const bars = MHB_TIERS.map((t) => {
      const m = mhb[t.id];
      const pct = ((m.value - t.seed) / (t.cap - t.seed)) * 100;
      return `<div class="dn-row"><label>${t.id === 'STORM' ? 'Storm' : 'Thunder'}</label><em><i style="width:${pct.toFixed(0)}%"></i></em><b>${fmtCoins(m.value * base)}</b></div>`;
    }).join('');
    const meter = v.meter(d);
    const meterPct = meter.charged ? 100 : (meter.points / METER_MAX) * 100;
    const h = v.hist(d);
    let recent = 'No spins yet';
    if (h.length) {
      const ret = h.reduce((s, x) => s + x[0], 0) / h.length;
      const feats = h.reduce((s, x) => s + x[1], 0);
      const cls = ret >= 1 ? 'up' : ret < 0.8 ? 'down' : '';
      recent = `Last ${h.length} spins: <b class="${cls}">${Math.round(ret * 100)}%</b> back · <b>${feats}</b> feature${feats === 1 ? '' : 's'}`;
    }
    return `<button class="dn ${d === v.current ? 'on' : ''}" data-d="${d}">
      <div class="dn-top"><b>${fmtDenom(d)}</b><span>${fmtCoins(betFor(d, 1))}–${fmtCoins(betFor(d, BET_MULTS.length))}</span></div>
      ${bars}
      <div class="dn-row"><label>Beast ${v.mult}x</label><em><i style="width:${meterPct.toFixed(0)}%"></i></em><b>${meter.charged ? 'AWAKE' : `${Math.floor(meterPct)}%`}</b></div>
      <div class="dn-recent">${recent}</div>
    </button>`;
  }).join('');
}
