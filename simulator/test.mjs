// Runs the spec's test cases plus a few sanity checks against the engine.
// Usage: node simulator/test.mjs
import './engine.js'

const E = globalThis.OffplanEngine
const brl = (v) => (v == null ? '—' : 'R$ ' + v.toLocaleString('pt-BR', { maximumFractionDigits: 2 }))
let failed = 0

for (const r of E.runTests()) {
  console.log(`\n${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
  for (const c of r.checks) {
    console.log(`  ${c.pass ? 'ok ' : 'BAD'} ${c.key.padEnd(11)} expected ${brl(c.expected).padEnd(16)} got ${brl(Math.round(c.got * 100) / 100)}`)
  }
  if (!r.pass) failed++
}

// Extra checks from the spec and the follow-up answers
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok ' : 'BAD'} ${name} ${detail}`)
  if (!cond) failed++
}
console.log('\nOther checks')
const t1 = E.simulate(E.TESTS[0].inputs)
check('Test 1 ITBI = 8.672,80', Math.abs(t1.itbi.value - 8672.8) < 0.01, brl(t1.itbi.value))
const t2 = E.simulate(E.TESTS[1].inputs)
check('Test 2 cessão fee = 7.798', Math.abs(t2.cessaoFee - 7798) < 1, brl(t2.cessaoFee))

const rep = E.simulate({ ...E.TESTS[0].inputs, structure: 'repasse', exitType: 'sale' })
check('Repasse sale: appraisal at keys ≈ 438k', Math.abs(rep.appraisalKeys - 438092) < 50, brl(rep.appraisalKeys))
check('Repasse sale: bank loan ≈ 350.5k', Math.abs(rep.loan - 350474) < 50, brl(rep.loan))
check('Repasse sale: shortfall ≈ 2k paid at keys', Math.abs(rep.shortfall - 2067) < 50 && Math.abs(rep.rows[24].shortfall - rep.shortfall) < 0.01, brl(rep.shortfall))

const d0 = E.monthDate('2026-12', 0)
const d24 = E.monthDate('2026-12', 24)
check('Dec 2026 → Dec 2028 = 731 days (15% IR)', E.daysBetween(d0, d24) === 731 && E.irRate(731) === 0.15)

const held = E.simulate({ ...E.TESTS[0].inputs, monthsAfterKeys: 3 })
const it25 = 1564.39 * Math.pow(1.06, 2) * Math.pow(1 + E.eff(18), 1)
check('Installment at month 25 uses post-keys index', Math.abs(held.rows[25].dev - it25) < 0.01, brl(held.rows[25].dev))
check('Held 3 months: amortization starts at month 25', held.rows[25].amort > 0 && held.rows[24].amort === 0)

const averb = E.simulate({ ...E.TESTS[0].inputs, monthsAfterKeys: 3, averbacaoMonths: 2 })
check('Averbação 2: months 25-26 charge full balance, amortization from 27',
  averb.rows[25].amort === 0 && averb.rows[26].amort === 0 && averb.rows[27].amort > 0)

console.log(`\nTest 1 summary: cash ${brl(Math.round(t1.cash))}, Scenario B ${brl(Math.round(t1.fvB))}, break-even ${brl(Math.round(t1.breakEven.value))} (+${((t1.breakEven.value / 389900 - 1) * 100).toFixed(1)}%), FR2 ${t1.fr2.toFixed(4)}`)
console.log(`Test 2 summary: cash ${brl(Math.round(t2.cash))}, Scenario B ${brl(Math.round(t2.fvB))}, break-even ${brl(Math.round(t2.breakEven.value))}`)

const def = E.simulate(E.DEFAULTS)
console.log(`Defaults: break-even ${brl(Math.round(def.breakEven.value))}, at 480k diff ${brl(Math.round(def.diff))}, IRR flip ${(def.irrFlip * 100).toFixed(1)}%, FI ${(def.irrFi * 100).toFixed(1)}%`)
console.log('Warnings:', def.warnings.map((w) => `${w.level}: ${w.code} ${JSON.stringify(w.args)}`))
check('Warnings carry codes, not text', def.warnings.every((w) => typeof w.code === 'string' && !('text' in w)))
const tor = E.tornado(E.DEFAULTS)
console.log('Tornado:', tor.items.map((x) => `${x.key} ${Math.round(x.low)}..${Math.round(x.high)}`).join(' | '))

process.exitCode = failed ? 1 : 0
console.log(failed ? `\n${failed} failure(s)` : '\nAll checks passed')
