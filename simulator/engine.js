/*
 * Off-plan flip vs fixed income: calculation engine.
 * Pure functions only (no DOM). Inlined into the page by build.mjs and imported by test.mjs.
 * Exposes globalThis.OffplanEngine.
 */
;(function (root) {
  'use strict'

  /** Annual % (effective) -> monthly fraction. */
  const eff = (annualPct) => Math.pow(1 + annualPct / 100, 1 / 12) - 1

  const LINES = {
    SBPE: { label: 'SBPE', bankRate: 11.49, rateNominal: false, ltvSac: 80, ltvPrice: 70 },
    MCMV: { label: 'MCMV Classe Média', bankRate: 10.0, rateNominal: true, ltvSac: 90, ltvPrice: 80 },
  }

  /** null on an "auto" field means: derive it from other inputs. */
  const DEFAULTS = Object.freeze({
    // 2.1 Property and developer payment plan
    price: 389900,
    monthsToKeys: 24,
    downPayment: 3000,
    nMonthly: 40,
    monthlyAmt: 1564.39,
    nAnnual: 3,
    annualAmt: 3000,
    annualMonths: '12, 24, 36',
    keysPayment: 1564.4,
    financed: 313760,
    incc: 6,
    postKeysIndex: 18,
    settleAtSale: true,
    earlyDiscount: 0,
    appraisalValue: null, // auto = price
    appraisalAtKeys: null, // auto = price corrected by INCC to keys
    // 2.2 Bank financing
    line: 'SBPE',
    structure: 'associativo', // 'associativo' | 'repasse'
    system: 'SAC', // 'SAC' | 'PRICE'
    bankRate: 11.49,
    rateNominal: false,
    ltvSac: 80,
    ltvPrice: 70,
    tr: 0.12,
    term: 420,
    mip: 0.025,
    dfi: 0.005,
    adminFee: 25,
    appraisalFee: 0,
    releasedAtSigning: 30,
    releaseCurve: 'linear', // 'linear' | 's'
    averbacaoMonths: 0,
    allIn: false,
    allInRate: 13.5,
    mcmvIncomeLimit: 13000,
    mcmvPriceLimit: 600000,
    // 2.3 Acquisition costs
    itbiOverride: null, // auto = rule
    itbiRate: 3,
    itbiReducedRate: 0.5,
    itbiReducedCap: 120968,
    itbiMaxValue: 725808,
    itbiExemptCeiling: 245527.77,
    firstProperty: false,
    valorVenal: null, // auto = price
    registry: 6530,
    registryDiscount: false,
    acqTiming: 'auto', // 'auto' | 'month0' | 'keys'
    // 2.4 Exit
    salePrice: 480000,
    monthsAfterKeys: 0,
    exitType: 'sale', // 'sale' | 'cessao'
    cessaoFee: 2,
    condoIptu: 600,
    commission: 6,
    lienRelease: 600,
    cgRate: 15,
    applyFr2: true,
    singlePropExempt: false,
    singlePropCeiling: 440000,
    reinvest: false,
    // 2.5 Fixed income
    fiNet: 13,
    fiGrossMode: false,
    fiGross: 15,
    fiExempt: false,
    // Calendar
    startMonth: '2026-12',
  })

  const num = (v, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
  const int = (v, fallback = 0) => Math.max(0, Math.round(num(v, fallback)))

  function parseMonthList(s) {
    return String(s || '')
      .split(/[,;\s]+/)
      .map((x) => parseInt(x, 10))
      .filter((x) => Number.isFinite(x) && x >= 0)
  }

  function monthDate(startMonth, t) {
    const m = /^(\d{4})-(\d{1,2})$/.exec(String(startMonth || ''))
    const y = m ? +m[1] : 2026
    const mo = m ? +m[2] - 1 : 11
    return new Date(Date.UTC(y, mo + t, 1))
  }

  const daysBetween = (a, b) => Math.round((b.getTime() - a.getTime()) / 86400000)

  /** Brazilian IR on fixed income, by calendar days held. */
  const irRate = (days) => (days <= 180 ? 0.225 : days <= 360 ? 0.2 : days <= 720 ? 0.175 : 0.15)

  function computeItbi(p, loan) {
    if (p.itbiOverride != null) return { value: num(p.itbiOverride), rule: 'manual' }
    const base = Math.max(p.price, p.valorVenal != null ? p.valorVenal : p.price)
    if (p.firstProperty && base <= p.itbiExemptCeiling) return { value: 0, rule: 'exempt', base }
    if (loan > 0 && p.price <= p.itbiMaxValue) {
      const reduced = Math.min(loan, p.itbiReducedCap)
      return {
        value: (p.itbiReducedRate / 100) * reduced + (p.itbiRate / 100) * (base - reduced),
        rule: 'sfh',
        base,
        reduced,
      }
    }
    return { value: (p.itbiRate / 100) * base, rule: 'general', base }
  }

  /** Build the whole schedule. Everything except the sale price. */
  function build(input) {
    const p = { ...DEFAULTS, ...input }
    // Warnings are codes + numbers; the page turns them into sentences in the chosen language.
    const warnings = []
    const warn = (level, code, args = {}) => warnings.push({ level, code, args })

    const T = Math.max(1, int(p.monthsToKeys, 24))
    const wantsCessao = p.exitType === 'cessao'
    const cessao = wantsCessao && p.structure === 'repasse'
    if (wantsCessao && !cessao) warn('bad', 'cessaoInvalid')
    let H = int(p.monthsAfterKeys)
    if (cessao && H > 0) {
      warn('info', 'cessaoHeld')
      H = 0
    }
    const S = T + H

    const g = eff(num(p.incc))
    const gp = eff(num(p.postKeysIndex))
    const i = p.rateNominal ? num(p.bankRate) / 1200 : eff(num(p.bankRate))
    const tr = num(p.tr) / 100
    const appraisal = p.appraisalValue != null ? p.appraisalValue : p.price
    const appraisalKeysAuto = p.price * Math.pow(1 + g, T)
    const appraisalKeys = p.appraisalAtKeys != null ? p.appraisalAtKeys : appraisalKeysAuto
    const ltv = (p.system === 'SAC' ? num(p.ltvSac) : num(p.ltvPrice)) / 100
    const lineLabel = (LINES[p.line] || { label: p.line }).label

    const rows = []
    for (let t = 0; t <= S; t++)
      rows.push({ t, dev: 0, shortfall: 0, intTR: 0, ins: 0, fee: 0, amort: 0, itbi: 0, registry: 0, apprFee: 0, condo: 0 })
    const basis = [] // capital-gains cost basis items { amt, t, kind }
    const addBasis = (amt, t, kind) => amt > 0 && basis.push({ amt, t, kind })

    // ---- 1. Developer installments -------------------------------------------------
    const corr = (d) => (d <= T ? Math.pow(1 + g, d) : Math.pow(1 + g, T) * Math.pow(1 + gp, d - T))
    const plan = [{ V: num(p.downPayment), d: 0, kind: 'down' }]
    for (let k = 1; k <= int(p.nMonthly); k++) plan.push({ V: num(p.monthlyAmt), d: k, kind: 'monthly' })
    const annualList = parseMonthList(p.annualMonths)
    const nAnnual = int(p.nAnnual)
    if (annualList.length < nAnnual)
      warn('warn', 'annualMismatch', { n: nAnnual, listed: annualList.length })
    annualList.slice(0, nAnnual).forEach((d) => plan.push({ V: num(p.annualAmt), d, kind: 'annual' }))
    plan.push({ V: num(p.keysPayment), d: T, kind: 'keys' })

    let devBalanceGross = 0
    let devAfterSaleCount = 0
    let devPaidAfterKeys = 0
    let devPaidAfterKeysCount = 0
    for (const it of plan) {
      if (it.V <= 0) continue
      if (it.d <= S) {
        const amt = it.V * corr(it.d)
        rows[it.d].dev += amt
        addBasis(amt, it.d, 'developer')
        if (it.d > T) {
          devPaidAfterKeys += amt
          devPaidAfterKeysCount++
        }
      } else {
        devBalanceGross += it.V * corr(S)
        devAfterSaleCount++
      }
    }
    const settled = !cessao && p.settleAtSale
    const devBalance = devBalanceGross * (settled ? 1 - num(p.earlyDiscount) / 100 : 1)
    addBasis(devBalance, S, 'developer balance')

    // ---- 2-4. Bank ------------------------------------------------------------------
    let loan = 0 // principal of the bank loan
    let assumed = 0 // balance assumed by the buyer under cessão
    let shortfall = 0
    let owedAtKeys = 0
    let loanStart = null
    let dfiBase = appraisal
    let constructionMonths = 0

    const chargeOn = (t, D) => {
      const r = rows[t]
      if (p.allIn) {
        const c = D * eff(num(p.allInRate))
        r.intTR += c
        addBasis(c, t, 'interest')
      } else {
        const it = D * (i + tr)
        r.intTR += it
        addBasis(it, t, 'interest')
        r.ins += (D * num(p.mip)) / 100 + (appraisal * num(p.dfi)) / 100
        r.fee += num(p.adminFee)
      }
      constructionMonths++
    }

    if (p.structure === 'associativo') {
      loan = num(p.financed)
      addBasis(loan, 0, 'financed principal')
      const p0 = Math.min(1, Math.max(0, num(p.releasedAtSigning) / 100))
      const rel = (t) => {
        if (T <= 1) return 1
        const x = (t - 1) / (T - 1)
        const f = p.releaseCurve === 's' ? x * x * (3 - 2 * x) : x
        return Math.min(1, p0 + (1 - p0) * f)
      }
      for (let t = 1; t <= T; t++) chargeOn(t, loan * rel(t))
      const k = int(p.averbacaoMonths)
      for (let t = T + 1; t <= Math.min(T + k, S); t++) chargeOn(t, loan)
      loanStart = T + k + 1
    } else {
      owedAtKeys = num(p.financed) * Math.pow(1 + g, T)
      if (cessao) {
        assumed = owedAtKeys
        addBasis(assumed, S, 'balance assumed by buyer')
      } else {
        loan = Math.min(owedAtKeys, ltv * appraisalKeys)
        shortfall = owedAtKeys - loan
        rows[T].shortfall += shortfall
        addBasis(loan, T, 'financed principal')
        addBasis(shortfall, T, 'developer')
        loanStart = T + 1
        dfiBase = appraisalKeys
      }
      if (int(p.averbacaoMonths) > 0)
        warn('info', 'averbRepasse')
    }

    const amortStep = (B, idx) => {
      const Bc = B * (1 + tr)
      const trC = Bc - B
      const rem = Math.max(1, int(p.term, 420) - idx)
      const interest = Bc * i
      let A
      if (p.system === 'SAC') A = Bc / rem
      else {
        const pmt = i > 0 ? (Bc * i) / (1 - Math.pow(1 + i, -rem)) : Bc / rem
        A = pmt - interest
      }
      const mip = (Bc * num(p.mip)) / 100
      const dfi = (dfiBase * num(p.dfi)) / 100
      return { Bc, trC, interest, A, mip, dfi, fee: num(p.adminFee), next: Bc - A }
    }

    let bankBalance = 0
    let firstInstallment = null
    if (loanStart !== null && loan > 0) {
      const s0 = amortStep(loan, 0)
      firstInstallment = s0.interest + s0.A + s0.mip + s0.dfi + s0.fee
      let B = loan
      for (let t = loanStart; t <= S; t++) {
        const s = amortStep(B, t - loanStart)
        const r = rows[t]
        r.intTR += s.interest
        r.amort += s.A
        r.ins += s.mip + s.dfi
        r.fee += s.fee
        addBasis(s.interest + s.trC, t, 'interest')
        B = s.next
      }
      bankBalance = B
    }

    // ---- 4b. Condo + IPTU after keys -----------------------------------------------
    for (let t = T + 1; t <= S; t++) rows[t].condo += num(p.condoIptu)

    // ---- 5. Acquisition costs ------------------------------------------------------
    let itbi = { value: 0, rule: 'none' }
    let registry = 0
    let apprFee = 0
    let acqMonth = null
    if (!cessao) {
      acqMonth =
        p.acqTiming === 'month0' ? 0 : p.acqTiming === 'keys' ? T : p.structure === 'associativo' ? 0 : T
      itbi = computeItbi(p, loan)
      registry = num(p.registry) * (p.registryDiscount ? 0.5 : 1)
      apprFee = num(p.appraisalFee)
      const bankMonth = p.structure === 'associativo' ? 0 : T
      rows[acqMonth].itbi += itbi.value
      rows[acqMonth].registry += registry
      rows[bankMonth].apprFee += apprFee
      addBasis(itbi.value, acqMonth, 'ITBI')
      addBasis(registry, acqMonth, 'registry')
      addBasis(apprFee, bankMonth, 'appraisal')
    }

    // ---- 6. Scenario B ------------------------------------------------------------
    const r = eff(num(p.fiNet))
    const rg = eff(num(p.fiGross))
    const dates = rows.map((_, t) => monthDate(p.startMonth, t))
    /** Value at month `to` of R$1 deposited at month `from`. */
    const growth = (from, to, rate) => {
      const n = to - from
      if (rate === 0) return 1
      if (!p.fiGrossMode) return Math.pow(1 + r, n)
      const gain = Math.pow(1 + rg, n) - 1
      const tax = p.fiExempt ? 0 : irRate(daysBetween(dates[from], dates[to]))
      return 1 + gain * (1 - tax)
    }

    let cash = 0
    let fvB = 0
    for (const row of rows) {
      row.date = dates[row.t]
      row.bank = row.intTR + row.ins + row.fee + row.amort
      row.acq = row.itbi + row.registry + row.apprFee
      row.devTotal = row.dev + row.shortfall
      row.total = row.devTotal + row.bank + row.acq + row.condo
      row.factor = growth(row.t, S, 1)
      row.fv = row.total * row.factor
      row.opp = row.fv - row.total
      cash += row.total
      fvB += row.fv
    }
    // Cumulative curves for the chart
    const curve = rows.map((row) => {
      let invested = 0
      let valueB = 0
      for (let s = 0; s <= row.t; s++) {
        invested += rows[s].total
        valueB += rows[s].total * growth(s, row.t, 1)
      }
      return { t: row.t, invested, valueB }
    })

    // ---- 8. Cost basis + FR2 ------------------------------------------------------
    const basisTotal = basis.reduce((a, b) => a + b.amt, 0)
    const fr2 = basisTotal > 0 ? basis.reduce((a, b) => a + b.amt / Math.pow(1.0035, S - b.t), 0) / basisTotal : 1

    const lien = !cessao && loan > 0 ? num(p.lienRelease) : 0
    const cessaoFee = cessao ? (num(p.cessaoFee) / 100) * p.price : 0
    const debtAtSale = bankBalance + assumed + devBalance

    // ---- 7. Exit at price P --------------------------------------------------------
    function exitAt(P) {
      const commission = (P * num(p.commission)) / 100
      const gain = P - commission - basisTotal
      let tax = (num(p.cgRate) / 100) * (p.applyFr2 ? fr2 : 1) * Math.max(0, gain)
      let exemption = null
      if (p.reinvest) exemption = 'reinvest'
      else if (p.singlePropExempt && P <= num(p.singlePropCeiling)) exemption = 'single'
      if (exemption) tax = 0
      const net = P - commission - tax - debtAtSale - lien - cessaoFee
      return { P, commission, gain, tax, exemption, net }
    }

    // Consistency check of the payment plan
    const planSum =
      num(p.downPayment) +
      int(p.nMonthly) * num(p.monthlyAmt) +
      Math.min(nAnnual, annualList.length) * num(p.annualAmt) +
      num(p.keysPayment) +
      num(p.financed)

    return {
      p, T, S, H, g, gp, i, tr, r, ltv, lineLabel, cessao, rows, curve, plan,
      cash, fvB, fv0: cash, basis, basisTotal, fr2, lien, cessaoFee, debtAtSale,
      bankBalance, assumed, devBalance, devBalanceGross, devAfterSaleCount, devPaidAfterKeys, devPaidAfterKeysCount,
      loan, shortfall, owedAtKeys, loanStart, firstInstallment, constructionMonths,
      appraisal, appraisalKeys, appraisalKeysAuto, itbi, registry, apprFee, acqMonth,
      planSum, planDiff: p.price - planSum,
      exitAt, warnings,
    }
  }

  /** Bisection between R$100k and R$5M, to R$1. `target` is the value the net proceeds must reach. */
  function breakEven(sim, target) {
    let lo = 100000
    let hi = 5000000
    const f = (P) => sim.exitAt(P).net - target
    if (f(hi) < 0) return { value: null, above: true }
    if (f(lo) >= 0) return { value: lo, below: true }
    while (hi - lo > 1) {
      const mid = (lo + hi) / 2
      if (f(mid) >= 0) hi = mid
      else lo = mid
    }
    return { value: (lo + hi) / 2 }
  }

  /** Monthly IRR of a flow vector (index = month), by bisection. Returns null if no sign change. */
  function irr(flows) {
    const npv = (rate) => flows.reduce((a, f, t) => a + f / Math.pow(1 + rate, t), 0)
    let lo = -0.99
    let hi = 1
    let flo = npv(lo)
    const fhi = npv(hi)
    if (!Number.isFinite(flo) || flo * fhi > 0) return null
    for (let k = 0; k < 200; k++) {
      const mid = (lo + hi) / 2
      const fm = npv(mid)
      if (fm * flo > 0) {
        lo = mid
        flo = fm
      } else hi = mid
      if (hi - lo < 1e-12) break
    }
    return (lo + hi) / 2
  }
  const annualize = (m) => (m == null ? null : Math.pow(1 + m, 12) - 1)

  /** Full simulation: schedule, break-evens, comparison at the expected price, IRR and warnings. */
  function simulate(input) {
    const sim = build(input)
    const { p, S } = sim
    const be = breakEven(sim, sim.fvB)
    const be0 = breakEven(sim, sim.fv0)
    const at = sim.exitAt(num(p.salePrice))
    const inccPrice = p.price * Math.pow(1 + sim.g, S)

    const flowsA = sim.rows.map((r) => -r.total)
    flowsA[S] += at.net
    const flowsB = sim.rows.map((r) => -r.total)
    flowsB[S] += sim.fvB
    const irrFlip = annualize(irr(flowsA))
    const irrFi = annualize(irr(flowsB))

    const out = {
      ...sim,
      breakEven: be,
      breakEvenZero: be0,
      at,
      diff: at.net - sim.fvB,
      inccPrice,
      irrFlip,
      irrFi,
    }
    addWarnings(out)
    return out
  }

  function addWarnings(s) {
    const { p, warnings } = s
    const warn = (level, code, args = {}) => warnings.push({ level, code, args })
    const sys = p.system
    if (p.structure === 'associativo') {
      const pct = p.financed / p.price
      if (pct > s.ltv + 1e-9)
        warn('bad', 'ltvOver', { pct, line: s.lineLabel, sys, cap: s.ltv, maxLoan: s.ltv * Math.min(p.price, s.appraisal) })
    } else if (!s.cessao && s.shortfall > 0.5) {
      warn('warn', 'repasseGap', { owed: s.owedAtKeys, cap: s.ltv, appraisal: s.appraisalKeys, loan: s.loan, gap: s.shortfall })
    }
    if (p.line === 'MCMV' && p.price > p.mcmvPriceLimit)
      warn('bad', 'mcmvPrice', { limit: p.mcmvPriceLimit, price: p.price })
    if (s.devAfterSaleCount > 0)
      warn('warn', 'devAfterSale', {
        count: s.devAfterSaleCount,
        amount: s.devBalance,
        mode: s.cessao ? 'cessao' : p.settleAtSale ? 'settle' : 'buyer',
      })
    if (s.devPaidAfterKeysCount > 0)
      warn('info', 'devAfterKeys', { count: s.devPaidAfterKeysCount, amount: s.devPaidAfterKeys, index: p.postKeysIndex })
    if (p.line === 'MCMV' && s.firstInstallment != null) {
      const income = s.firstInstallment / 0.3
      if (income > p.mcmvIncomeLimit)
        warn('bad', 'mcmvIncome', { sys, inst: s.firstInstallment, income, limit: p.mcmvIncomeLimit })
    }
    if (p.salePrice <= p.singlePropCeiling && !p.singlePropExempt && !p.reinvest && s.at.tax > 0)
      warn('info', 'singleProp', { ceiling: p.singlePropCeiling })
    if (s.breakEven.above) warn('bad', 'beAbove5M')
    else if (s.breakEven.value > p.salePrice)
      warn('bad', 'beAboveExpected', { be: s.breakEven.value, price: p.salePrice })
    if (Math.abs(s.planDiff) > 1) warn('warn', 'planMismatch', { sum: s.planSum, diff: s.planDiff })
    if (s.cessao) warn('info', 'cessaoConsent')
  }

  // ---------------------------------------------------------------------------------
  // Sensitivity
  const bePrice = (input) => {
    const sim = build(input)
    return breakEven(sim, sim.fvB).value
  }

  function tornado(p) {
    const base = bePrice(p)
    // key names the input; lowSet/highSet are the raw settings tried (the page formats them).
    const v = (key, lowSet, low, highSet, high) => ({
      key,
      lowSet,
      highSet,
      low: bePrice({ ...p, ...low }),
      high: bePrice({ ...p, ...high }),
    })
    const assocExit = p.exitType === 'cessao' ? { exitType: 'sale' } : {}
    const fiBase = p.fiGrossMode ? p.fiGross : p.fiNet
    const held = int(p.monthsAfterKeys)
    const items = [
      v('fi', fiBase - 3, { fiNet: p.fiNet - 3, fiGross: p.fiGross - 3 }, fiBase + 3, { fiNet: p.fiNet + 3, fiGross: p.fiGross + 3 }),
      v('incc', 0, { incc: 0 }, p.incc + 2, { incc: p.incc + 2 }),
      v('bankRate', p.bankRate - 1, { bankRate: p.bankRate - 1 }, p.bankRate + 1, { bankRate: p.bankRate + 1 }),
      v('tr', 0, { tr: 0 }, p.tr + 0.05, { tr: p.tr + 0.05 }),
      v('commission', 4, { commission: 4 }, 8, { commission: 8 }),
      v('released', 10, { releasedAtSigning: 10 }, 60, { releasedAtSigning: 60 }),
      v('monthsAfter', 0, { monthsAfterKeys: 0 }, held + 3, { monthsAfterKeys: held + 3 }),
      v('line', 'SBPE', { line: 'SBPE', ...lineFields('SBPE') }, 'MCMV', { line: 'MCMV', ...lineFields('MCMV') }),
      v('structure', 'associativo', { structure: 'associativo', ...assocExit }, 'repasse', { structure: 'repasse' }),
    ]
    items.forEach((it) => {
      const vals = [it.low, it.high, base].filter((x) => x != null)
      it.range = Math.max(...vals) - Math.min(...vals)
    })
    items.sort((a, b) => b.range - a.range)
    return { base, items }
  }

  function grid(p) {
    const fi = [10, 13, 15]
    const incc = [0, 4, 6]
    const fiKey = p.fiGrossMode ? 'fiGross' : 'fiNet'
    return {
      fi,
      incc,
      fiKey,
      cells: incc.map((ic) => fi.map((f) => bePrice({ ...p, incc: ic, [fiKey]: f }))),
      bankRates: [10, 11, 12].map((br) => ({ rate: br, value: bePrice({ ...p, bankRate: br }) })),
      systems: ['SAC', 'PRICE'].map((sys) => ({ system: sys, value: bePrice({ ...p, system: sys }) })),
    }
  }

  function lineFields(name) {
    const l = LINES[name]
    return { bankRate: l.bankRate, rateNominal: l.rateNominal, ltvSac: l.ltvSac, ltvPrice: l.ltvPrice }
  }


  // ---------------------------------------------------------------------------------
  // Test cases (section 6 of the spec)
  const TEST1_INPUTS = {
    ...DEFAULTS,
    structure: 'associativo',
    exitType: 'sale',
    monthsAfterKeys: 0,
    incc: 6,
    fiNet: 13,
    fiGrossMode: false,
    bankRate: 11,
    rateNominal: false,
    tr: 0.15,
    mip: 0.02,
    dfi: 0.007,
    adminFee: 25,
    appraisalFee: 2500,
    releasedAtSigning: 20,
    releaseCurve: 'linear',
    averbacaoMonths: 0,
    allIn: false,
    itbiOverride: null,
    valorVenal: null,
    appraisalValue: null,
    registry: 4000,
    registryDiscount: false,
    acqTiming: 'auto',
    commission: 6,
    lienRelease: 600,
    settleAtSale: true,
    earlyDiscount: 0,
    applyFr2: true,
    singlePropExempt: false,
    reinvest: false,
  }
  const TESTS = [
    {
      id: 't1',
      name: 'Test 1: associativo, sale at keys',
      inputs: TEST1_INPUTS,
      expect: { cash: 114799, fvB: 129857, devBalance: 31495, breakEven: 509169 },
    },
    {
      id: 't2',
      name: 'Test 2: repasse na entrega + cessão at keys',
      inputs: { ...TEST1_INPUTS, structure: 'repasse', exitType: 'cessao', cessaoFee: 2 },
      expect: { cash: 51226, fvB: 57435, assumed: 352541, cessaoFee: 7798, breakEven: 480562 },
    },
  ]

  function runTests(tolerance = 500) {
    return TESTS.map((tc) => {
      const s = simulate(tc.inputs)
      const actual = {
        cash: s.cash,
        fvB: s.fvB,
        devBalance: s.devBalance,
        assumed: s.assumed,
        cessaoFee: s.cessaoFee,
        breakEven: s.breakEven.value,
      }
      const checks = Object.entries(tc.expect).map(([key, expected]) => {
        const got = actual[key]
        return { key, expected, got, pass: got != null && Math.abs(got - expected) <= tolerance }
      })
      return { id: tc.id, name: tc.name, inputs: tc.inputs, checks, pass: checks.every((c) => c.pass) }
    })
  }

  root.OffplanEngine = {
    DEFAULTS, LINES, TESTS, eff, irRate, monthDate, daysBetween, parseMonthList, computeItbi,
    build, simulate, breakEven, irr, tornado, grid, lineFields, runTests,
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
